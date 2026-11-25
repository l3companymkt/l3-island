// Fila de pedidos de permissão do Claude Code. O hook fica esperando (long-poll)
// até você permitir/negar na ilha, no celular, ou mandar de volta para o terminal.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const path = require('path');

const bus = new EventEmitter();
const pending = new Map(); // id -> { req, resolve, timer }

function summarize(ev) {
  const i = ev.tool_input || {};
  const tool = ev.tool_name || 'Ferramenta';
  let detail = '';
  if (i.command) detail = i.command;
  else if (i.file_path) detail = i.file_path;
  else if (i.url) detail = i.url;
  else if (i.pattern) detail = i.pattern;
  else if (i.prompt) detail = i.prompt;
  else detail = JSON.stringify(i);
  return {
    tool, detail: String(detail).slice(0, 600), description: i.description ? String(i.description).slice(0, 200) : '',
    project: ev.cwd ? path.basename(ev.cwd) : '', session: ev.session_id,
  };
}

function list() {
  return [...pending.values()].map(p => p.req);
}

function request(ev, waitMs) {
  const id = crypto.randomBytes(8).toString('hex');
  const req = { id, at: Date.now(), expires: Date.now() + waitMs, ...summarize(ev) };
  return {
    id,
    promise: new Promise(resolve => {
      const timer = setTimeout(() => finish(id, { decision: 'ask', reason: 'timeout' }), waitMs);
      pending.set(id, { req, resolve, timer });
      bus.emit('change', list());
      bus.emit('new', req);
    }),
  };
}

function finish(id, result) {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(result);
  bus.emit('change', list());
  return true;
}

// O hook encerrou (o usuário cancelou a tarefa no Claude, por exemplo)
function cancel(id) { finish(id, { decision: 'ask', reason: 'cancelled' }); }

module.exports = { bus, list, request, finish, cancel };
