// Source-image fetch.
//
// dcinside blocks image hotlinking, so the bytes have to be fetched server-side
// with a gall.dcinside.com Referer. That is ALL this module does — it hands the
// original bytes back and `/img` re-serves them with permissive CORS.
//
// There is deliberately no image conversion here. The glasses app does its own
// tone-map/quantize in the WebView canvas (g2-app/src/glasses/imageprep.ts),
// which is the pipeline that was validated on real hardware. A server-side
// converter used to live here; it pulled in `sharp` (a native binary that makes
// every deployment target harder) and nothing called it.
import { fetchBinary } from './client.js';

const REFERER = 'https://gall.dcinside.com/';

export async function loadSource(url) {
  // dccon/viewimage both live behind the Referer check.
  const { buffer, contentType } = await fetchBinary(url, REFERER);
  return { buffer, contentType };
}
