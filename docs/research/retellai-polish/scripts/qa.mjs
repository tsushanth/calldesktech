import { chromium } from 'playwright';
import fs from 'fs';
const OUT='docs/design-references/retellai-polish';
const b=await chromium.launch();
async function cap(w,h,name){
  const p=await b.newPage({viewport:{width:w,height:h}});
  await p.goto('http://localhost:3050/',{waitUntil:'networkidle'});
  await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,110));}window.scrollTo(0,0);});
  await p.waitForTimeout(1200);
  await p.screenshot({path:`${OUT}/${name}.png`,fullPage:true});
  const m=await p.evaluate(()=>{
    const g=(s)=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);const r=e.getBoundingClientRect();return{fs:c.fontSize,fw:c.fontWeight,lh:c.lineHeight,ls:c.letterSpacing,w:Math.round(r.width)};};
    return {docHeight:document.body.scrollHeight, h1:g('h1'), h2:g('h2'), h3:g('h3'),
      container:(()=>{const e=document.querySelector('main section > div');return e?Math.round(e.getBoundingClientRect().width):null})(),
      sectionPads:[...document.querySelectorAll('main section')].map(s=>{const c=getComputedStyle(s);return c.paddingTop+'/'+c.paddingBottom+' h='+Math.round(s.getBoundingClientRect().height);}),
      revealHidden:[...document.querySelectorAll('main section *')].filter(e=>getComputedStyle(e).opacity==='0').length};
  });
  console.log(name, JSON.stringify(m,null,1));
  await p.close();
}
await cap(1440,900,'calldesktech-1440');
await cap(390,844,'calldesktech-390');
await b.close();
