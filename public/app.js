// SwiftLink dashboard
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadLinks() {
  const body = $('links-body');
  try {
    const links = await api('/api/links');
    if (!links.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">No links yet — create one above!</td></tr>';
      return;
    }
    body.innerHTML = '';
    for (const l of links) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><a href="/${esc(l.code)}" target="_blank">${esc(l.shortUrl)}</a></td>
        <td><span class="dest" title="${esc(l.url)}">${esc(l.url)}</span></td>
        <td><strong>${l.clicks}</strong></td>
        <td class="muted">${new Date(l.created_at + 'Z').toLocaleDateString()}</td>
        <td><div class="actions">
          <button class="small" data-act="stats">📊 Stats</button>
          <button class="small danger" data-act="del">Delete</button>
        </div></td>`;
      tr.querySelector('[data-act="stats"]').onclick = () => showStats(l.code);
      tr.querySelector('[data-act="del"]').onclick = () => deleteLink(l.code);
      body.appendChild(tr);
    }
  } catch (e) {
    body.innerHTML = `<tr><td colspan="5" class="error">${esc(e.message)}</td></tr>`;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('url-input').value.trim();
  const alias = $('alias-input').value.trim();
  $('create-error').classList.add('hidden');
  $('create-result').classList.add('hidden');
  try {
    const link = await api('/api/links', {
      method: 'POST',
      body: JSON.stringify({ url, alias: alias || undefined }),
    });
    const a = $('result-link');
    a.href = link.shortUrl;
    a.textContent = link.shortUrl;
    $('create-result').classList.remove('hidden');
    $('copy-ok').classList.add('hidden');
    $('url-input').value = '';
    $('alias-input').value = '';
    loadLinks();
  } catch (err) {
    const el = $('create-error');
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
});

$('copy-btn').addEventListener('click', async () => {
  const text = $('result-link').textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  $('copy-ok').classList.remove('hidden');
});

async function deleteLink(code) {
  if (!confirm(`Delete short link /${code}?`)) return;
  await api(`/api/links/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if ($('stats-code').textContent === code) $('stats-card').classList.add('hidden');
  loadLinks();
}

async function showStats(code) {
  const s = await api(`/api/links/${encodeURIComponent(code)}/stats`);
  $('stats-code').textContent = '/' + code;
  $('stat-total').textContent = s.totalClicks;
  const today = new Date().toISOString().slice(0, 10);
  const t = s.clicksPerDay.find((d) => d.date === today);
  $('stat-today').textContent = t ? t.clicks : 0;
  drawChart(s.clicksPerDay);
  const ul = $('referrers');
  ul.innerHTML = '';
  if (!s.topReferrers.length) ul.innerHTML = '<li class="muted">No clicks yet</li>';
  for (const r of s.topReferrers) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(r.referrer)}</span><span class="count">${r.clicks}</span>`;
    ul.appendChild(li);
  }
  const qr = $('qr-img');
  qr.src = `/api/links/${encodeURIComponent(code)}/qr?t=${Date.now()}`;
  qr.classList.remove('hidden');
  $('stats-card').classList.remove('hidden');
  $('stats-card').scrollIntoView({ behavior: 'smooth' });
}

function drawChart(days) {
  const c = $('chart');
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(1, ...days.map((d) => d.clicks));
  const n = days.length;
  const gap = 8;
  const bw = (W - 40 - gap * (n - 1)) / n;
  ctx.fillStyle = '#8b949e';
  ctx.font = '10px sans-serif';
  days.forEach((d, i) => {
    const h = (H - 60) * (d.clicks / max);
    const x = 30 + i * (bw + gap);
    const y = H - 30 - h;
    const grad = ctx.createLinearGradient(0, y, 0, H - 30);
    grad.addColorStop(0, '#79b8ff');
    grad.addColorStop(1, '#1f6feb');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, bw, h);
    if (d.clicks > 0) {
      ctx.fillStyle = '#e6edf3';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.clicks), x + bw / 2, y - 6);
    }
    if (i % 2 === 0) {
      ctx.fillStyle = '#8b949e';
      ctx.textAlign = 'center';
      ctx.fillText(d.date.slice(5), x + bw / 2, H - 12);
    }
  });
}

$('stats-close').addEventListener('click', () => $('stats-card').classList.add('hidden'));

loadLinks();
