// Themes
const THEMES = [
  {id:'default',name:'Classic Green',bg:'#0a0c0f',ac:'#00c47a'},
  {id:'arctic', name:'Arctic Blue',  bg:'#060c18',ac:'#00e5ff'},
  {id:'amber',  name:'Amber Terminal',bg:'#0c0900',ac:'#ffd060'},
  {id:'glass-purple',name:'Glass Purple',bg:'#08041a',ac:'#00ffcc'},
  {id:'glass-teal',  name:'Glass Teal', bg:'#000c10',ac:'#00dca0'},
  {id:'glass-rose',  name:'Glass Rose', bg:'#100408',ac:'#00ffaa'},
  {id:'light',       name:'Light',      bg:'#f0f2f5',ac:'#00a865'},
];
let curTheme = 'default';

window.applyTheme = (t, save=true) => {
  curTheme = t;
  document.documentElement.setAttribute('data-theme', t==='default'?'':t);
  if (save && window.saveTheme) window.saveTheme(t);
  document.querySelectorAll('.theme-opt').forEach(el => el.classList.toggle('sel', el.dataset.t===t));
};

window.openThemePicker = () => {
  document.getElementById('themeGrid').innerHTML = THEMES.map(t=>`
    <div class="theme-opt ${curTheme===t.id?'sel':''}" data-t="${t.id}" onclick="applyTheme('${t.id}')">
      <div class="theme-swatch" style="background:${t.bg};border:2px solid ${t.ac};"></div>
      <div class="theme-name">${t.name}</div>
    </div>`).join('');
  openModal('themeModal');
};
