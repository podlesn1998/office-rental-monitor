import { createStealthPage } from './server/scrapers/browser.js';

const { page, context } = await createStealthPage();

const url = 'https://spb.cian.ru/cat.php?currency=2&deal_type=rent&engine_version=2&foot_min=45&maxarea=70&maxprice=90000&metro%5B0%5D=174&metro%5B1%5D=175&metro%5B2%5D=176&metro%5B3%5D=177&metro%5B4%5D=194&metro%5B5%5D=206&metro%5B6%5D=207&metro%5B7%5D=221&metro%5B8%5D=222&minarea=40&minprice=50000&offer_type=offices&office_type%5B0%5D=5&only_foot=2&region=2&p=1';

console.log('Navigating...');
await page.goto(url, { waitUntil: 'load', timeout: 35000 });
await page.waitForTimeout(4000);

const title = await page.title();
console.log('Title:', title);

// Scroll to trigger lazy loading
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const links = Array.from(document.querySelectorAll('a[href*="/rent/commercial/"]'));
  const ids = new Set<string>();
  links.forEach(a => {
    const m = (a as HTMLAnchorElement).href.match(/\/rent\/commercial\/(\d+)/);
    if (m) ids.add(m[1]);
  });
  
  // Count containers
  let validContainers = 0;
  let noContainers = 0;
  const seenIds: string[] = [];
  for (const link of links) {
    const m = (link as HTMLAnchorElement).href.match(/\/rent\/commercial\/(\d+)/);
    if (!m || seenIds.includes(m[1])) continue;
    seenIds.push(m[1]);
    
    let container: Element | null = link.parentElement;
    let depth = 0;
    while (container && depth < 20) {
      const text = container.textContent ?? '';
      if (text.includes('₽/мес') && text.includes('м²')) break;
      container = container.parentElement;
      depth++;
    }
    if (container && container.textContent?.includes('₽/мес') && container.textContent?.includes('м²')) {
      validContainers++;
    } else {
      noContainers++;
    }
  }
  
  return {
    totalLinks: links.length,
    uniqueIds: ids.size,
    validContainers,
    noContainers,
    bodyLength: document.body.innerHTML.length,
    hasRubMes: document.body.textContent?.includes('₽/мес'),
    hasMkv: document.body.textContent?.includes('м²'),
  };
});

console.log('Result:', JSON.stringify(result, null, 2));

await page.screenshot({ path: '/home/ubuntu/cian-playwright.png', fullPage: false });
console.log('Screenshot saved to /home/ubuntu/cian-playwright.png');

await context.close();
process.exit(0);
