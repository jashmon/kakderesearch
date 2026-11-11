let y=0;const h=document.getElementById('top');addEventListener('scroll',()=>{const n=scrollY;h.classList.toggle('is-hidden',n>y&&n>160);y=n},{passive:true});
