import polka from 'polka';
import handler from './api/index.js'; 

const app = polka();
const PORT = process.env.PORT || 3000;
app.all('/api/hit', (req, res) => handler(req, res));
app.all('/api/get', (req, res) => handler(req, res));
app.get('/', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hit Counter API is running on Render!');
});


app.listen(PORT, err => {
  if (err) throw err;
  console.log(`> Running on localhost:${PORT}`);
});
