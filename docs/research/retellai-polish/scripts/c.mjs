import { chromium } from 'playwright';
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://localhost:3050/',{waitUntil:'networkidle'});
console.log(await p.evaluate(()=>{
 const w=[...document.querySelectorAll('div')].map(d=>getComputedStyle(d).maxWidth).filter(v=>v!=='none').reduce((a,v)=>{a[v]=(a[v]||0)+1;return a;},{});
 // header scroll behavior check
 return {maxWidths:Object.entries(w).sort((a,b)=>b[1]-a[1]).slice(0,6)};
}));
const hdr=async()=>p.evaluate(()=>{const h=document.querySelector('header');const c=getComputedStyle(h);return c.backgroundColor+' | '+c.backdropFilter+' | '+c.borderBottomColor;});
console.log('header@0  ', await hdr());
await p.evaluate(()=>window.scrollTo(0,400)); await p.waitForTimeout(600);
console.log('header@400', await hdr());
// hover test on a card
const card=p.locator('#capabilities .rounded-xl').first();
const before=await card.evaluate(e=>getComputedStyle(e).transform+' '+getComputedStyle(e).borderColor);
await card.hover(); await p.waitForTimeout(500);
const after=await card.evaluate(e=>getComputedStyle(e).transform+' '+getComputedStyle(e).borderColor);
console.log('card hover before:',before,'\ncard hover after :',after);
// FAQ accordion
const d=p.locator('#faq details').first();
console.log('faq open before:', await d.evaluate(e=>e.open));
await d.locator('summary').click(); await p.waitForTimeout(300);
console.log('faq open after :', await d.evaluate(e=>e.open));
await b.close();
