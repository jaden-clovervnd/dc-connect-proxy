// Parsers for the dcinside MOBILE site (m.dcinside.com).
// The mobile board is used because:
//   - its HTML is ~1/3 the size of desktop,
//   - comments are embedded inline as JSON-LD (no anti-bot AJAX / e_s_n_o token),
//   - the article body carries image URLs as lazyload `data-original` attributes.
import * as cheerio from 'cheerio';
import { fetchHtml, warm } from './client.js';

const BASE = 'https://m.dcinside.com';

function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// ---- LIST ---------------------------------------------------------------
// https://m.dcinside.com/board/{id}?page=N            (all posts, 전체글)
// https://m.dcinside.com/board/{id}?recommend=1&page=N (recommended, 개념글)
// Works for both main and minor galleries — same mobile path.
export async function getList(galleryId, page = 1, mode = 'all') {
  await warm(galleryId);
  const rec = mode === 'recommend' ? 'recommend=1&' : '';
  const url = `${BASE}/board/${galleryId}?${rec}page=${page}`;
  const html = await fetchHtml(url, `${BASE}/`);
  const $ = cheerio.load(html);

  const posts = [];
  $('ul.gall-detail-lst > li').each((_, li) => {
    const $li = $(li);
    const $a = $li.find('a.lt').first();
    const href = $a.attr('href') || '';
    const m = href.match(/\/board\/[^/]+\/(\d+)/);
    if (!m) return; // skip ads / separators
    const no = m[1];

    const title = clean($a.find('.subjectin').text());
    const hasImage = $a.find('.sp-lst-img').length > 0;
    const ginfo = $a.find('ul.ginfo > li');
    const category = clean($(ginfo[0]).text());
    const nick = clean($a.find('.list-nick').clone().children().remove().end().text());
    const time = clean($(ginfo[2]).text());
    const views = clean($(ginfo[3]).text()).replace(/[^\d]/g, '');
    const recommend = clean($a.find('ul.ginfo > li').last().find('span').text());
    const commentCount = clean($li.find('a.rt .ct').text()).replace(/[^\d]/g, '');

    posts.push({
      no,
      title,
      author: nick,
      category,
      time,
      views: Number(views) || 0,
      recommend: Number(recommend) || 0,
      commentCount: Number(commentCount) || 0,
      hasImage,
      url: `${BASE}/board/${galleryId}/${no}`,
    });
  });

  return { galleryId, page, mode, count: posts.length, posts };
}

// ---- POST ---------------------------------------------------------------
// https://m.dcinside.com/board/{id}/{no}
export async function getPost(galleryId, no) {
  await warm(galleryId);
  const url = `${BASE}/board/${galleryId}/${no}`;
  const html = await fetchHtml(url, `${BASE}/board/${galleryId}`);
  const $ = cheerio.load(html);

  const title = clean($('.gallview-tit-box .tit, span.tit').first().text())
    .replace(/^\[[^\]]*\]\s*/, (m) => m); // keep category tag as-is

  const author = clean($('.ginfo2 .nick').first().text());
  const date = clean($('.ginfo2 li').filter((_, el) => /\d{2}\.\d{2}/.test($(el).text())).first().text());

  // Body: the article content lives in .thum-txt
  const $body = $('.thum-txt').first();

  // Images: mobile lazy-loads via data-original; fall back to src.
  const images = [];
  $body.find('img').each((_, img) => {
    const src = $(img).attr('data-original') || $(img).attr('src') || '';
    const u = src.replace(/&amp;/g, '&').trim();
    if (!u || u.startsWith('data:')) return;
    const kind = /dccon\.php/.test(u) ? 'dccon' : 'photo';
    images.push({ url: u, kind });
  });

  // Body text: strip scripts/styles, keep readable text with line breaks.
  $body.find('script,style,.adv,.ad').remove();
  const bodyText = clean($body.text());

  // Comments: read from the rendered list, NOT the JSON-LD block.
  //
  // The page ships both, but the JSON-LD `comment` array only carries top-level
  // comments — every reply is missing. A post showing "댓글 7" came back with 2.
  // The `.all-comment-lst` markup has all of them, replies included, so parse
  // that and keep the JSON-LD only as a fallback if the markup ever changes.
  const domComments = parseListComments($);
  const comments = domComments.length ? domComments : parseJsonLdComments(html);

  // True total as the page itself reports it — trust this over comments.length,
  // which can lag if dcinside paginates a very long thread.
  const reported = Number($('#reple_totalCnt').attr('value')) || 0;

  return {
    galleryId,
    no,
    title,
    author,
    date,
    bodyText,
    images,
    commentCount: reported || comments.length,
    comments,
    url,
  };
}

/**
 * Comments from the rendered `.all-comment-lst` markup.
 *
 * Each <li> is one comment; replies carry `comment-add` in the class and their
 * text starts with `@대상`. We keep that marker — on a 576px glasses line it is
 * the only thing distinguishing a reply from a new comment.
 *
 * A dccon (sticker) comment carries an `img.written_dccon` and often no text at
 * all. The glasses can't render it, but dropping the row would make the thread
 * skip a beat and the count disagree with the page, so it becomes `[디시콘]`.
 *
 * Deleted rows and injected ads have neither text nor a dccon, and are skipped.
 */
function parseListComments($) {
  const out = [];
  $('.all-comment-lst > li').each((_i, el) => {
    const $li = $(el);
    const body = clean($li.find('p.txt').text());
    const dccon = $li.find('img.written_dccon').length > 0;
    const text = dccon ? (body ? `${body} [디시콘]` : '[디시콘]') : body;
    if (!text) return; // deleted comment or an injected ad row
    // .nick holds a trailing <span class="nicknum"> counter — drop it.
    const author = clean($li.find('.nick').clone().children('.nicknum').remove().end().text());
    out.push({
      author,
      text,
      date: clean($li.find('.date').text()),
      reply: /comment-add/.test($li.attr('class') || ''),
    });
  });
  return out;
}

function parseJsonLdComments(html) {
  const out = [];
  // Note: dcinside emits two ld+json blocks with inconsistent spacing:
  //   <script type="application/ld+json">      (BreadcrumbList)
  //   <script type = "application/ld+json">    (DiscussionForumPosting w/ comments)
  const re = /<script type\s*=\s*"application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      const comments = node && node.comment;
      if (!Array.isArray(comments)) continue;
      for (const c of comments) {
        out.push({
          author: (c.author && c.author.name) || '',
          text: clean(c.text),
          date: c.datePublished || '',
        });
      }
    }
  }
  return out;
}
