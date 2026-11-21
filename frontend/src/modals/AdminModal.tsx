import { useCallback, useEffect, useState } from "react";
import { api, type AdminCaseSetting, type AdminUser } from "../api";
import { fmt } from "../lib/format";
import Sheet from "../ui/Sheet";

/** Готовые ступени удачи. Сервер всё равно ограничивает значение MAX_LUCK. */
const LUCK_STEPS = [1, 1.5, 2, 3, 5];

function luckLabel(value: number) {
  return value > 1 ? `×${fmt(value)}` : "обычные";
}

export default function AdminModal({
  telegramId,
  onClose,
  onChanged,
}: {
  telegramId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [cases, setCases] = useState<AdminCaseSetting[]>([]);
  const [maxLuck, setMaxLuck] = useState(5);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [found, settings] = await Promise.all([
        api.adminUsers(telegramId, ""),
        api.adminSettings(telegramId),
      ]);
      setUsers(found.users);
      setCases(settings.cases);
      setMaxLuck(settings.max_luck);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось открыть админ-панель");
    } finally {
      setBusy(false);
    }
  }, [telegramId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function search() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const found = await api.adminUsers(telegramId, query);
      setUsers(found.users);
      if (found.users.length === 0) setNote("Игрок не найден. Проверьте ID или username.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Поиск не удался");
    } finally {
      setBusy(false);
    }
  }

  function patchUser(updated: AdminUser) {
    setUsers((cur) =>
      cur.map((user) => (user.telegram_id === updated.telegram_id ? updated : user)),
    );
  }

  async function toggleAdmin(user: AdminUser) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const result = await api.setAdminRights(telegramId, user.telegram_id, !user.is_admin);
      patchUser(result.user);
      setNote(
        `${user.username ? `@${user.username}` : user.telegram_id}: ${
          result.user.is_admin ? "админка выдана" : "админка снята"
        }`,
      );
      if (user.telegram_id === telegramId) onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить права");
    } finally {
      setBusy(false);
    }
  }

  async function applyUserLuck(user: AdminUser, luck: number) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const result = await api.setUserLuck(telegramId, user.telegram_id, luck);
      patchUser(result.user);
      setNote(
        `${user.username ? `@${user.username}` : user.telegram_id}: удача ${luckLabel(luck)}`,
      );
      if (user.telegram_id === telegramId) onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить удачу");
    } finally {
      setBusy(false);
    }
  }

  async function addBalance(user: AdminUser) {
    const raw = (amounts[user.telegram_id] ?? "").trim();
    const amount = Math.round(Number(raw));
    if (!Number.isFinite(amount) || amount < 1) {
      setError("Введите сумму больше 0");
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      const result = await api.addBalance(telegramId, user.telegram_id, amount);
      patchUser(result.user);
      setAmounts((cur) => ({ ...cur, [user.telegram_id]: "" }));
      setNote(
        `${user.username ? `@${user.username}` : user.telegram_id}: зачислено ${amount} ⭐`,
      );
      if (user.telegram_id === telegramId) onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начислить баланс");
    } finally {
      setBusy(false);
    }
  }

  async function applyCaseLuck(item: AdminCaseSetting, luck: number) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await api.setCaseLuck(telegramId, item.id, luck);
      setCases((cur) =>
        cur.map((setting) =>
          setting.id === item.id ? { ...setting, luck_multiplier: luck } : setting,
        ),
      );
      setNote(`«${item.title}»: удача ${luckLabel(luck)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить шансы");
    } finally {
      setBusy(false);
    }
  }

  const steps = LUCK_STEPS.filter((value) => value <= maxLuck);

  return (
    <Sheet title="Админ-панель" onClose={onClose} tall>
      {error && <p className="notice bad">{error}</p>}
      {note && <p className="notice good">{note}</p>}

      <section className="admin-block">
        <h3 className="admin-title">Игроки</h3>
        <form
          className="admin-search"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <input
            className="admin-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Telegram ID или @username"
            inputMode="search"
            autoComplete="off"
          />
          <button className="btn primary" type="submit" disabled={busy}>
            Найти
          </button>
        </form>

        {users.length === 0 ? (
          <p className="empty">
            {busy ? "Загружаем игроков…" : "Никого не нашли. Введите Telegram ID."}
          </p>
        ) : (
          <div className="admin-users">
            {users.map((user) => {
              const isSelf = user.telegram_id === telegramId;
              const cannotRevoke = user.is_root || (isSelf && user.is_admin);
              return (
                <div key={user.telegram_id} className="admin-user">
                  <div className="admin-user-head">
                    <b>{user.username ? `@${user.username}` : "Без username"}</b>
                    <small>
                      ID {user.telegram_id} · {fmt(user.balance_stars)} ⭐
                    </small>
                    {user.is_root && <span className="admin-tag">владелец</span>}
                    {user.is_admin && !user.is_root && <span className="admin-tag">админ</span>}
                  </div>

                  <div className="admin-row">
                    <span className="admin-label">Права</span>
                    <button
                      type="button"
                      className="btn outline small"
                      onClick={() => void toggleAdmin(user)}
                      disabled={busy || cannotRevoke}
                      title={
                        user.is_root
                          ? "Владелец задан в ADMIN_IDS — снимается только там"
                          : undefined
                      }
                    >
                      {user.is_admin ? "Снять админку" : "Выдать админку"}
                    </button>
                  </div>

                  <div className="admin-row">
                    <span className="admin-label">Удача</span>
                    <div className="admin-chips">
                      {steps.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`admin-chip${
                            user.luck_multiplier === value ? " active" : ""
                          }`}
                          onClick={() => void applyUserLuck(user, value)}
                          disabled={busy}
                        >
                          {luckLabel(value)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="admin-row">
                    <span className="admin-label">Баланс</span>
                    <div className="admin-balance">
                      <input
                        className="admin-input small"
                        inputMode="numeric"
                        placeholder="Сумма ⭐"
                        value={amounts[user.telegram_id] ?? ""}
                        onChange={(event) =>
                          setAmounts((cur) => ({
                            ...cur,
                            [user.telegram_id]: event.target.value.replace(/[^\d]/g, ""),
                          }))
                        }
                      />
                      <div className="admin-chips">
                        {[100, 500, 1000].map((value) => (
                          <button
                            key={value}
                            type="button"
                            className="admin-chip"
                            onClick={() =>
                              setAmounts((cur) => ({
                                ...cur,
                                [user.telegram_id]: String(value),
                              }))
                            }
                            disabled={busy}
                          >
                            +{value}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn primary small"
                        onClick={() => void addBalance(user)}
                        disabled={busy}
                      >
                        Начислить
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="fine">
          Свой Telegram ID впишите в переменную <b>ADMIN_IDS</b> (Railway → Variables,
          несколько ID через запятую) или в <b>backend/config.py</b>. Игрок должен хотя бы
          раз открыть приложение, чтобы появиться в базе.
        </p>
      </section>

      <section className="admin-block">
        <h3 className="admin-title">Шансы кейсов</h3>
        <p className="fine">
          Множитель повышает вероятность дорогих призов для всех игроков. Персональная
          удача складывается с общей.
        </p>
        {cases.length === 0 ? (
          <p className="empty">Кейсы не загрузились.</p>
        ) : (
          cases.map((item) => (
            <div key={item.id} className="admin-case">
              <div className="admin-user-head">
                <b>{item.title}</b>
                <small>{fmt(item.price)} ◆ за открытие</small>
                {item.luck_multiplier > 1 && (
                  <span className="admin-tag">×{fmt(item.luck_multiplier)}</span>
                )}
              </div>
              <div className="admin-chips">
                {steps.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`admin-chip${
                      item.luck_multiplier === value ? " active" : ""
                    }`}
                    onClick={() => void applyCaseLuck(item, value)}
                    disabled={busy}
                  >
                    {luckLabel(value)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <p className="fine">
        Изменения применяются сразу: следующий открытый кейс уже использует новые шансы.
      </p>
    </Sheet>
  );
}
