// Moderação de conteúdo gerado por usuários (exigência Google Play / App Store):
// bloquear usuário, denunciar post/comentário/perfil e fila para o admin.

const REPORT_REASONS = {
  spam: 'Spam ou propaganda',
  assedio: 'Assédio, bullying ou ameaça',
  odio: 'Discurso de ódio ou discriminação',
  sexual: 'Conteúdo sexual ou nudez',
  violencia: 'Violência ou conteúdo perigoso',
  falso: 'Perfil falso ou golpe',
  outro: 'Outro motivo',
};

// SQL: exclui autores que eu bloqueei ou que me bloquearam. Usa 2 parâmetros (uid, uid).
function notHiddenSql(col) {
  return `(${col} NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?) AND ${col} NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?))`;
}

function hiddenIds(db, uid) {
  const out = new Set();
  if (!uid) return out;
  db.prepare('SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = ?').all(uid).forEach((r) => out.add(r.id));
  db.prepare('SELECT blocker_id AS id FROM user_blocks WHERE blocked_id = ?').all(uid).forEach((r) => out.add(r.id));
  return out;
}

function isHidden(db, a, b) {
  if (!a || !b) return false;
  return !!db.prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a);
}

function blockUser(db, blockerId, blockedId) {
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  db.prepare('INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?,?)').run(blockerId, blockedId);
  db.prepare('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)').run(blockerId, blockedId, blockedId, blockerId);
  return true;
}

function unblockUser(db, blockerId, blockedId) {
  db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
}

// Resolve o alvo da denúncia e devolve { type, id, userId, preview } ou null.
function resolveTarget(db, type, id) {
  id = parseInt(id, 10);
  if (!id) return null;
  if (type === 'post') {
    const p = db.prepare('SELECT id, user_id, body FROM posts WHERE id = ?').get(id);
    return p ? { type, id, userId: p.user_id, preview: (p.body || '').slice(0, 200) } : null;
  }
  if (type === 'comment') {
    const c = db.prepare('SELECT id, user_id, body FROM comments WHERE id = ?').get(id);
    return c ? { type, id, userId: c.user_id, preview: (c.body || '').slice(0, 200) } : null;
  }
  if (type === 'user') {
    const u = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
    return u ? { type, id, userId: u.id, preview: u.name } : null;
  }
  return null;
}

function createReport(db, reporterId, target, reason, details) {
  const key = REPORT_REASONS[reason] ? reason : 'outro';
  const dup = db.prepare("SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'").get(reporterId, target.type, target.id);
  if (dup) return dup.id;
  const info = db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, target_user_id, reason, details, preview) VALUES (?,?,?,?,?,?,?)')
    .run(reporterId, target.type, target.id, target.userId, key, (details || '').trim().slice(0, 600) || null, target.preview || null);
  return info.lastInsertRowid;
}

function removeUserModerationData(db, uid) {
  db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?').run(uid, uid);
  db.prepare('DELETE FROM reports WHERE reporter_id = ? OR target_user_id = ?').run(uid, uid);
}

module.exports = { REPORT_REASONS, notHiddenSql, hiddenIds, isHidden, blockUser, unblockUser, resolveTarget, createReport, removeUserModerationData };
