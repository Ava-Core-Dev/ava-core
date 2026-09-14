-- Ava (root@rootrecord.info) is a permanent lifetime member.
UPDATE user_accounts
SET life_member = 1, pro_unlocked = 1, updated_at = datetime('now')
WHERE lower(email) = 'root@rootrecord.info';
