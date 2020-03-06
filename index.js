// adapted from https://github.com/muralikg/puppetcam

const puppeteer = require('puppeteer');
const path = require('path');
const Xvfb = require('xvfb');
const xvfb = new Xvfb({silent: true});
const width = 1920;
const height = 1080;
const options = {
  headless: false,
  args: [
    '--disable-gpu',
    '--disable-features=site-per-process',
    '--enable-usermedia-screen-capturing',
    '--allow-http-screen-capture',
    '--auto-select-desktop-capture-source=puppetcam',
    `--load-extension=${__dirname}/recorder`,
    `--disable-extensions-except=${__dirname}/recorder`,
    '--disable-infobars',
    `--window-size=${width},${height}`,
  ],
}

const { email, password } = require('./credentials.js');

const main = async () => {
  xvfb.startSync()
  const url = 'https://zoom.us/start/videomeeting'
  const browser = await puppeteer.launch(options)
  const pages = await browser.pages()
  const loginPage = await browser.newPage()
  page = pages[0]

  await page._client.send('Emulation.clearDeviceMetricsOverride')
  const client = await page.target().createCDPSession()
  // FIXME: downloads still go to ~/Downloads, not the recordings folder.
  await client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: path.resolve(__dirname, 'recordings')});
  await page.goto(url, { waitUntil: 'networkidle2' })
  await page.setBypassCSP(true)

  let code
  try {
    await loginPage.goto(url, {waitUntil: 'networkidle0'})

    await loginPage.waitForSelector('#email', { timeout: 0 });
    try {
      await loginPage.waitForSelector('.truste_overlay', { timeout: 10000 });
      const frames = loginPage.frames()
      const consentFrame = frames.find(f => f.url().startsWith('https://consent-pref.trustarc.com/?type=zoom'))
      await consentFrame.click('.pdynamicbutton .call')
      await consentFrame.waitForSelector('#gwt-debug-close_id')
      await consentFrame.click('#gwt-debug-close_id')
    } catch (e) { }

    await loginPage.type('#email', email)
    await loginPage.type('#password', password)
    await loginPage.click('.signin.user')

    await loginPage.waitForNavigation({ waitUntil: 'networkidle2' })

    code = loginPage.url().match(/[0-9]{9,}/g)[0]
    console.log(`https://zoom.us/wc/join/${code}`)
    loginPage.close();

    await page.goto(`https://zoom.us/wc/${code}/start`, { waitUntil: 'networkidle0' })

    try {
      await page.waitForSelector('#btn_end_meeting', { timeout: 5000 })
	    console.log('ending')
      await page.click('#btn_end_meeting')
      await page.waitForNavigation({ waitUntil: 'networkidle0' })
    } catch (e) {console.log('end not found')}

    try {
      await page.waitForSelector('#wc_continue', { timeout: 5000 })
	    console.log('continuing')
      await page.click('#wc_continue')
      await page.waitForNavigation({ waitUntil: 'networkidle0' })
    } catch (e) {console.log('continue not found')}

    // start recording
    await page.evaluate(() => {
      document.title = 'puppetcam'
      window.postMessage({ type: 'REC_CLIENT_PLAY', data: { url: window.location.origin } }, '*')
    })

    await page.waitFor(5000)
    await page.keyboard.press('F11')
    await page.click('#dialog-join .zm-btn')
    await page.click('.footer-button__button.ax-outline[aria-label="open the chat pane"]')

    let numParticipants = '1';
    while (numParticipants === '1') {
      await page.waitFor(5000)
      numParticipants = await page.$eval('.footer-button__number-counter > span', e => e.innerHTML)
      console.log(numParticipants)
    }

    while (numParticipants !== '1') {
      await page.waitFor(5000)
      numParticipants = await page.$eval('.footer-button__number-counter > span', e => e.innerHTML)
      console.log(numParticipants)
    }

    await page.click('.footer__leave-btn')
    await page.click('.zm-modal-footer-default-actions > button:nth-of-type(1)')
  } catch (e) {
	  console.error(e)
	  await page.screenshot({ path: 'screen.png' })
	  console.log(await page.content())
  }

  // stop recording
  await page.evaluate(filename=>{
    window.postMessage({type: 'SET_EXPORT_PATH', filename }, '*')
    window.postMessage({type: 'REC_STOP'}, '*')
  }, `${new Date().toISOString().split('T', 1)[0]}_${code}.webm`)

  // Wait for download of webm to complete
  await page.waitForSelector('html.downloadComplete', {timeout: 0})
  await browser.close()
  xvfb.stopSync()
}

main()
