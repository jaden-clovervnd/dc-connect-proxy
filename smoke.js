// End-to-end smoke test against the live automata gallery (no server needed).
import { getList, getPost } from './src/dcinside.js';
import { loadSource } from './src/image.js';

const GALLERY = process.env.GALLERY || 'automata';

function line(s = '') { console.log(s); }

const list = await getList(GALLERY, 1);
line(`LIST ${GALLERY} page1 -> ${list.count} posts`);
for (const p of list.posts.slice(0, 5)) {
  line(`  #${p.no} [${p.category}] ${p.title}  (by ${p.author}, 💬${p.commentCount}${p.hasImage ? ' 🖼' : ''})`);
}

// Pick the first real post that has an image, else the first with comments.
const withImg = list.posts.find((p) => p.hasImage) || list.posts[0];
line();
line(`POST #${withImg.no} ...`);
const post = await getPost(GALLERY, withImg.no);
line(`  title : ${post.title}`);
line(`  author: ${post.author}   date: ${post.date}`);
line(`  body  : ${post.bodyText.slice(0, 120)}${post.bodyText.length > 120 ? '…' : ''}`);
line(`  images: ${post.images.length} (${post.images.map((i) => i.kind).join(', ')})`);
line(`  comments: ${post.commentCount}`);
for (const c of post.comments.slice(0, 5)) line(`    - ${c.author}: ${c.text}`);

const photo = post.images.find((i) => i.kind === 'photo') || post.images[0];
if (photo) {
  line();
  line(`IMAGE ${photo.url.slice(0, 70)}...`);
  const { buffer } = await loadSource(photo.url);
  line(`  downloaded ${buffer.length} bytes`);
  line('  (conversion happens in the glasses app, not here)');
} else {
  line('\n(no image in this post to convert)');
}
line('\nOK');
