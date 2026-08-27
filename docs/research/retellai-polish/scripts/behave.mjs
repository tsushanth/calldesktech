import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('https://www.retellai.com',{waitUntil:'networkidle',timeout:90000});
await p.waitForTimeout(2500);
// find elements below fold that are hidden/translated pre-scroll, then reveal on scroll
const r=await p.evaluate(async()=>{
  const cands=[...document.querySelectorAll('section *')].filter(el=>{
    const c=getComputedStyle(el);
    return (parseFloat(c.opacity)<0.9 || c.transform!=='none') && el.getBoundingClientRect().height>40;
  }).slice(0,400);
  const before=cands.map(el=>{const c=getComputedStyle(el);return {o:c.opacity,t:c.transform,tr:c.transition};});
  // scroll through
  for(let y=0;y<document.body.scrollHeight;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,150));}
  await new Promise(r=>setTimeout(r,1200));
  const changed=[];
  cands.forEach((el,i)=>{
    const c=getComputedStyle(el);
    if(c.opacity!==before[i].o||c.transform!==before[i].t)
      changed.push({tag:el.tagName,cls:(el.className||'').toString().slice(0,60),from:before[i],to:{o:c.opacity,t:c.transform},transition:c.transition.slice(0,120)});
  });
  return {total:cands.length, changedCount:changed.length, sample:changed.slice(0,12)};
});
console.log(JSON.stringify(r,null,1));
// hover state on primary button
const h=await p.evaluate(()=>{const el=[...document.querySelectorAll('a,button')].find(e=>/get started|start|demo|contact/i.test(e.textContent||''));if(!el)return null;const c=getComputedStyle(el);return{cls:(el.className||'').toString().slice(0,80),bg:c.backgroundColor,radius:c.borderRadius,pad:c.padding,fs:c.fontSize,fw:c.fontWeight,transition:c.transition};});
console.log('PRIMARY BTN',JSON.stringify(h,null,1));
await b.close();
