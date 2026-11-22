/* מחשבון האבנים הקטנות · the saved-mapping store.
 *
 * One job: hold a mapping behind a short code so a business can pass it
 * between people and open it on another device. The code IS the key — whoever
 * has it can read and write, exactly like a link-shared document — so it is
 * long enough that guessing one is not a strategy: 10 characters of Crockford
 * base32, about 10^15 of them, and a wrong guess costs a round trip.
 *
 * The body is the same deflated payload the #z= link carries. The Worker never
 * parses it; it stores bytes and gives them back. Nothing here knows what a
 * task is.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford: no I, L, O, U
const CODE_LEN = 10;
const MAX_BYTES = 64 * 1024;
const TTL = 60 * 60 * 24 * 730;                        // two years from the last write

const ORIGINS = [
  'https://calc.waives.io',
  'http://localhost:8777',
  'http://localhost:8921'
];

function cors(origin){
  const allow = ORIGINS.indexOf(origin) !== -1 ? origin : ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: Object.assign({'Content-Type': 'application/json; charset=utf-8',
                          'Cache-Control': 'no-store'}, cors(origin))
});

function newCode(){
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for(let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}
const validCode = c => typeof c === 'string' && c.length === CODE_LEN &&
  [...c].every(ch => ALPHABET.indexOf(ch) !== -1);

/* The payload is base64url text, so anything outside that alphabet is not ours. */
const validBody = t => typeof t === 'string' && t.length > 0 &&
  t.length <= MAX_BYTES && /^[A-Za-z0-9\-_]+$/.test(t);

export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || '';
    if(request.method === 'OPTIONS') return new Response(null, {status:204, headers:cors(origin)});

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if(parts[0] === 'health') return json({ok:true}, 200, origin);
    if(parts[0] !== 'm') return json({error:'not found'}, 404, origin);

    /* POST /m — a new mapping, a new code. Retried on the astronomically
       unlikely chance that a code is already taken. */
    if(request.method === 'POST' && parts.length === 1){
      const body = await request.text();
      if(!validBody(body)) return json({error:'bad body'}, 400, origin);
      for(let i = 0; i < 4; i++){
        const code = newCode();
        if(await env.STONES.get(code) === null){
          await env.STONES.put(code, body, {expirationTtl:TTL});
          return json({code}, 201, origin);
        }
      }
      return json({error:'busy'}, 503, origin);
    }

    if(parts.length !== 2 || !validCode(parts[1])) return json({error:'bad code'}, 400, origin);
    const code = parts[1];

    if(request.method === 'GET'){
      const body = await env.STONES.get(code);
      if(body === null) return json({error:'gone'}, 404, origin);
      return json({code, body}, 200, origin);
    }

    /* PUT /m/:code — whoever holds the code may write, which is the whole point:
       the manager sends it, the person who does the work fills it in. A PUT to a
       code that was never created is refused, so the store cannot be seeded with
       chosen codes. */
    if(request.method === 'PUT'){
      const body = await request.text();
      if(!validBody(body)) return json({error:'bad body'}, 400, origin);
      if(await env.STONES.get(code) === null) return json({error:'gone'}, 404, origin);
      await env.STONES.put(code, body, {expirationTtl:TTL});
      return json({code}, 200, origin);
    }

    return json({error:'method'}, 405, origin);
  }
};
