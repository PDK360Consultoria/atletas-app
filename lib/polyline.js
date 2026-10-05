// Codec puro-JS (sem dependências) do formato "Google Encoded Polyline
// Algorithm" — https://developers.google.com/maps/documentation/utilities/polylinealgorithm
// É o mesmo formato que o Strava devolve em map.summary_polyline, então um
// decodificador aqui serve tanto pra rotas importadas por GPX (que a gente
// mesmo codifica, ver downsample() + encode()) quanto pras do Strava.

const PRECISION = 1e5; // 5 casas decimais — padrão do formato e do Strava

function encode(points) {
  // points: array de [lat, lon]
  let output = '';
  let prevLat = 0;
  let prevLon = 0;
  for (const [lat, lon] of points) {
    const lat5 = Math.round(lat * PRECISION);
    const lon5 = Math.round(lon * PRECISION);
    output += encodeSignedNumber(lat5 - prevLat);
    output += encodeSignedNumber(lon5 - prevLon);
    prevLat = lat5;
    prevLon = lon5;
  }
  return output;
}

function encodeSignedNumber(num) {
  let sgnNum = num << 1;
  if (num < 0) sgnNum = ~sgnNum;
  return encodeNumber(sgnNum);
}

function encodeNumber(num) {
  let output = '';
  while (num >= 0x20) {
    output += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
    num >>= 5;
  }
  output += String.fromCharCode(num + 63);
  return output;
}

function decode(str) {
  // devolve array de [lat, lon]
  if (!str) return [];
  let index = 0;
  const len = str.length;
  let lat = 0;
  let lon = 0;
  const points = [];
  while (index < len) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlon = (result & 1) ? ~(result >> 1) : (result >> 1);
    lon += dlon;

    points.push([lat / PRECISION, lon / PRECISION]);
  }
  return points;
}

// Reduz um array grande de pontos [lat, lon] pra no máximo `maxPoints`,
// pegando um a cada N de forma uniforme (mantém sempre o primeiro e o
// último). Suficiente pra desenhar o traçado — não precisamos de GPS de
// alta resolução pra um SVG de uns 300x200px.
function downsample(points, maxPoints = 150) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points || [];
  const step = (points.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

module.exports = { encode, decode, downsample };
