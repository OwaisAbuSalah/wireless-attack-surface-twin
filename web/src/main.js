import './styles/app.css';
import { App } from './app.js';

const app = new App();
app.init().catch((err) => {
  console.error(err);
  const m = document.getElementById('loader-msg');
  if (m) m.textContent = `WebGL2 error: ${err.message}`;
});
