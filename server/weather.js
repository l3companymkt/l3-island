// Previsão do tempo via Open-Meteo: gratuito, sem conta e sem chave de API.
// É o único widget que precisa de internet; o resto do painel é 100% local.
const https = require('https');

const CODES = {
  0: ['Céu limpo', '☀'], 1: ['Poucas nuvens', '🌤'], 2: ['Parcialmente nublado', '⛅'], 3: ['Nublado', '☁'],
  45: ['Neblina', '🌫'], 48: ['Neblina', '🌫'], 51: ['Garoa', '🌦'], 53: ['Garoa', '🌦'], 55: ['Garoa', '🌦'],
  61: ['Chuva fraca', '🌧'], 63: ['Chuva', '🌧'], 65: ['Chuva forte', '🌧'], 71: ['Neve', '🌨'], 73: ['Neve', '🌨'],
  75: ['Neve', '🌨'], 80: ['Pancadas', '🌦'], 81: ['Pancadas', '🌧'], 82: ['Temporal', '⛈'], 95: ['Trovoadas', '⛈'],
  96: ['Trovoadas', '⛈'], 99: ['Trovoadas', '⛈'],
};

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

async function geocode(city) {
  const r = await get(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=${encodeURIComponent(city)}`);
  const g = r.results && r.results[0];
  if (!g) throw new Error('Cidade não encontrada');
  return { lat: g.latitude, lon: g.longitude, city: `${g.name}${g.admin1 ? ', ' + g.admin1 : ''}` };
}

async function fetchWeather(w) {
  if (w.lat == null || w.lon == null) return null;
  const r = await get(`https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=4&timezone=auto');
  const c = r.current;
  const [label, icon] = CODES[c.weather_code] || ['—', '·'];
  return {
    city: w.city, temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m, wind: Math.round(c.wind_speed_10m), label, icon,
    days: r.daily.time.map((t, i) => ({
      date: t, max: Math.round(r.daily.temperature_2m_max[i]), min: Math.round(r.daily.temperature_2m_min[i]),
      rain: r.daily.precipitation_probability_max[i], icon: (CODES[r.daily.weather_code[i]] || ['', '·'])[1],
    })),
    at: Date.now(),
  };
}

module.exports = { geocode, fetchWeather };
