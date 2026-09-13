const $ = id => document.getElementById(id);
let roomId = new URL(location.href).searchParams.get('room');
let socket, view, stopped = false, refreshing;
const { issuer } = await (await fetch('/auth-config')).json();
const status = text => { $('status').textContent = text; };

function login() {
  stopped = true;
  const url = new URL('/login', issuer); url.searchParams.set('return_to', location.href); location.assign(url);
}
async function refresh() {
  if (!refreshing) refreshing = fetch(new URL('/refresh', issuer), { credentials: 'include', cache: 'no-store' })
    .then(response => { if (response.status === 401) { login(); return false; } if (!response.ok) throw Error('認証を更新できません'); return true; })
    .finally(() => { refreshing = undefined; });
  return refreshing;
}
/** 認証段階の401だけ再試行する。通信失敗やゲームCommandを自動再送しない。 */
async function api(path, body) {
  const options = { credentials: 'include', cache: 'no-store', ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) };
  let response = await fetch(path, options);
  if (response.status === 401) {
    if (!(await refresh())) throw Error('ログインへ移動します');
    response = await fetch(path, options);
    if (response.status === 401) { login(); throw Error('ログインが必要です'); }
  }
  const result = await response.json();
  if (!response.ok || result.ok === false) throw Error(result.error?.detail ?? result.error?.code ?? '操作できませんでした');
  return result;
}
function showRoomId() {
  $('join').textContent = roomId ? 'この部屋に参加' : '部屋を作る';
  $('invite-label').hidden = !roomId;
  if (roomId) { history.replaceState(null, '', `?room=${encodeURIComponent(roomId)}`); $('invite').value = location.href; }
}
async function connect() {
  if (stopped) return;
  await api('/api/me'); // 再接続時に認証を確認する。接続中の定期再認証は行わない。
  if (stopped) return;
  const url = new URL(`/ws/rooms/${roomId}`, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(url); socket = current;
  current.onopen = () => { status('接続しました'); $('join-form').hidden = true; };
  current.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'ViewStateEvent') { view = message.viewState; render(); }
    if (message.ok === false || message.type === 'ProtocolErrorEvent') status(message.error?.detail ?? message.error?.code ?? '操作できませんでした');
  };
  current.onclose = event => {
    if (socket !== current || stopped) return;
    if (event.code === 1008) { status('この部屋への接続が許可されていません'); return; }
    status('再接続しています…'); setTimeout(() => connect().catch(error => status(error.message)), 1500);
  };
}
function send(command) {
  if (socket?.readyState !== WebSocket.OPEN) { status('接続をお待ちください'); return; }
  socket.send(JSON.stringify({ type: 'GameCommandRequest', requestId: crypto.randomUUID(), command }));
}
function render() {
  $('room').hidden = false;
  $('phase').textContent = { lobby: 'ロビー', playing: '対戦中', finished: '結果' }[view.phase];
  $('players').replaceChildren(...view.players.map(player => {
    const li = document.createElement('li'); li.textContent = `${player.name}${player.isYou ? '（あなた）' : ''} — ${player.score}点 / ${player.ready ? '準備済み' : 'デッキ未選択'}`; return li;
  }));
  $('deck-form').hidden = !view.availableActions.includes('select-deck');
  $('start').hidden = !view.availableActions.includes('start');
  $('turn').textContent = view.activePlayer ? `${view.activePlayer}さんの手番` : '';
  $('cards').replaceChildren(...(view.phase === 'playing' ? view.yourCards : []).map(card => {
    const button = document.createElement('button'); button.textContent = `${card.id} / ${card.power}点`;
    button.disabled = !view.availableActions.includes('play');
    button.onclick = () => send({ type: 'play', cardId: card.id, decisionId: view.decision.id }); return button;
  }));
}
$('join-form').onsubmit = async event => {
  event.preventDefault(); $('join').disabled = true;
  try {
    if (!roomId) { roomId = (await api('/api/rooms', {})).roomId; showRoomId(); }
    await api(`/api/rooms/${roomId}/join`, { name: $('name').value });
    await connect();
  } catch (error) { status(error.message); } finally { $('join').disabled = false; }
};
$('deck-form').onsubmit = async event => {
  event.preventDefault();
  try { await api(`/api/rooms/${roomId}/deck`, { deckId: $('deck').value }); } catch (error) { status(error.message); }
};
$('start').onclick = () => send({ type: 'start' });
showRoomId();
try {
  await api('/api/me');
  const { decks } = await api('/api/decks');
  for (const deck of decks) { const option = document.createElement('option'); option.value = deck.id; option.textContent = deck.name; $('deck').append(option); }
  status('表示名を入力してください');
} catch (error) { status(error.message); }
