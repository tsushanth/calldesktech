import { chromium } from 'playwright';
import fs from 'fs';
const OUT='docs/design-references/retellai-polish', RES='docs/research/retellai-polish';
const b = await chromium.launch();

async function shot(w,h,name){
  const p = await b.newPage({viewport:{width:w,height:h}, deviceScaleFactor:1});
  await p.goto('https://www.retellai.com',{waitUntil:'networkidle',timeout:90000});
  await p.waitForTimeout(3000);
  // trigger lazy/scroll animations
  await p.evaluate(async()=>{ for(let y=0;y<document.body.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,120));} window.scrollTo(0,0);});
  await p.waitForTimeout(1500);
  await p.screenshot({path:`${OUT}/${name}.png`, fullPage:true});
  return p;
}

const p = await shot(1440,900,'desktop-1440');
// ---- global extraction ----
const data = await p.evaluate(()=>{
  const px=v=>v;
  const secs=[];
  const roots=[...document.querySelectorAll('body > *, body > * > section, main > section, main > div')];
  const seen=new Set();
  function summarize(el){
    const cs=getComputedStyle(el), r=el.getBoundingClientRect();
    return {tag:el.tagName.toLowerCase(), cls:(el.className||'').toString().slice(0,120),
      w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top+scrollY),
      bg:cs.backgroundColor, bgImage:cs.backgroundImage.slice(0,80), color:cs.color,
      pt:cs.paddingTop,pb:cs.paddingBottom,pl:cs.paddingLeft,pr:cs.paddingRight,
      mt:cs.marginTop,mb:cs.marginBottom, display:cs.display, gap:cs.gap,
      maxW:cs.maxWidth, position:cs.position, radius:cs.borderRadius, border:cs.border,
      font:cs.fontFamily.slice(0,60), fs:cs.fontSize, fw:cs.fontWeight, lh:cs.lineHeight, ls:cs.letterSpacing};
  }
  // all sections top-to-bottom
  document.querySelectorAll('section, header, footer, main > div').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(r.height<80||r.width<300) return;
    const k=Math.round(r.top+scrollY)+'-'+Math.round(r.height);
    if(seen.has(k)) return; seen.add(k);
    const s=summarize(el);
    s.headings=[...el.querySelectorAll('h1,h2,h3,h4')].slice(0,6).map(h=>{const c=getComputedStyle(h);return {t:h.tagName,fs:c.fontSize,fw:c.fontWeight,lh:c.lineHeight,ls:c.letterSpacing,font:c.fontFamily.slice(0,40),color:c.color,mb:c.marginBottom};});
    s.paras=[...el.querySelectorAll('p')].slice(0,3).map(h=>{const c=getComputedStyle(h);return {fs:c.fontSize,fw:c.fontWeight,lh:c.lineHeight,color:c.color,maxW:c.maxWidth};});
    s.buttons=[...el.querySelectorAll('a[class*=button],button,a[href]')].slice(0,4).map(h=>{const c=getComputedStyle(h);return {fs:c.fontSize,fw:c.fontWeight,pad:c.padding,radius:c.borderRadius,bg:c.backgroundColor,color:c.color,border:c.border,transition:c.transition};});
    secs.push(s);
  });
  // color census
  const colors={},fonts={},sizes={},radii={};
  document.querySelectorAll('*').forEach(el=>{
    const c=getComputedStyle(el);
    [c.color,c.backgroundColor].forEach(v=>{if(v&&v!=='rgba(0, 0, 0, 0)')colors[v]=(colors[v]||0)+1;});
    fonts[c.fontFamily.slice(0,50)]=(fonts[c.fontFamily.slice(0,50)]||0)+1;
    sizes[c.fontSize]=(sizes[c.fontSize]||0)+1;
    if(c.borderRadius!=='0px')radii[c.borderRadius]=(radii[c.borderRadius]||0)+1;
  });
  const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,25);
  const html=document.documentElement, body=document.body;
  return {sections:secs, colors:top(colors), fonts:top(fonts), sizes:top(sizes), radii:top(radii),
    html:{scrollBehavior:getComputedStyle(html).scrollBehavior, bg:getComputedStyle(body).backgroundColor, font:getComputedStyle(body).fontFamily, fs:getComputedStyle(body).fontSize},
    containers:[...document.querySelectorAll('div')].map(d=>getComputedStyle(d).maxWidth).filter(v=>v!=='none').reduce((a,v)=>{a[v]=(a[v]||0)+1;return a;},{}),
    docHeight:document.body.scrollHeight};
});
fs.writeFileSync(`${RES}/global-extraction.json`, JSON.stringify(data,null,2));

// ---- interaction sweep: header on scroll ----
const beh = await p.evaluate(async()=>{
  const hdr=document.querySelector('header')||document.querySelector('nav');
  const snap=()=>{const c=getComputedStyle(hdr);return {bg:c.backgroundColor,blur:c.backdropFilter,h:hdr.getBoundingClientRect().height,pad:c.padding,border:c.borderBottom,shadow:c.boxShadow,transform:c.transform,transition:c.transition,position:c.position};};
  const at0=snap();
  window.scrollTo(0,600); await new Promise(r=>setTimeout(r,900));
  const at600=snap();
  window.scrollTo(0,2000); await new Promise(r=>setTimeout(r,900));
  const at2000=snap();
  window.scrollTo(0,0); await new Promise(r=>setTimeout(r,600));
  // detect scroll-animation attributes used across page
  const animAttrs={};
  document.querySelectorAll('*').forEach(el=>{ [...el.attributes].forEach(a=>{ if(/data-(aos|framer|scroll|animate|motion)|style/.test(a.name)&&/opacity|translate|animate|inview/i.test(a.value+a.name)) animAttrs[a.name]=(animAttrs[a.name]||0)+1;});});
  return {at0,at600,at2000,animAttrs};
});
fs.writeFileSync(`${RES}/behaviors-raw.json`, JSON.stringify(beh,null,2));
await p.close();
await shot(390,844,'mobile-390').then(x=>x.close());
await b.close();
console.log('done', data.sections.length,'sections, docHeight',data.docHeight);
