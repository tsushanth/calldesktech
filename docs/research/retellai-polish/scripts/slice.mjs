import { chromium } from 'playwright';
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:1100}});
await p.goto('http://localhost:3050/',{waitUntil:'networkidle'});
await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,110));}window.scrollTo(0,0);});
await p.waitForTimeout(1000);
const secs=['hero','preview','capabilities','blocks','how','faq','cta'];
const els=await p.$$('main > section');
for(let i=0;i<els.length;i++){ await els[i].screenshot({path:`docs/design-references/retellai-polish/qa-${i}-${secs[i]||i}.png`}); }
await b.close();
