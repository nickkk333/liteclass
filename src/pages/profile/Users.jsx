import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ShieldCheck, UserRound } from "lucide-react";
import { api, fmtWatch, fmtDateTime } from "../../api.js";
import { useAuth } from "../../App.jsx";
import { useToast, Modal, Confirm, Empty, Spinner, Avatar, Switch } from "../../components/ui.jsx";
import SubHeader from "../../components/SubHeader.jsx";

export default function UsersView({ onBack }) {
  const { user: me, isAdmin } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState(null);
  const [levels, setLevels] = useState([]);
  const [edit, setEdit] = useState(null);
  const [editLevel, setEditLevel] = useState(null);
  const [remove, setRemove] = useState(null);

  const load = async () => {
    try {
      const [u, l] = await Promise.all([api("/admin/users"), api("/admin/levels")]);
      setUsers(u); setLevels(l);
    } catch (e) { toast(e.message, "error"); setUsers([]); }
  };
  useEffect(() => { load(); }, []);

  const levelName = (id) => levels.find((l) => l.id === id)?.name || "一级学员";
  const levelColor = (id) => levels.find((l) => l.id === id)?.text_color || "#6B7280";

  const saveUser = async () => {
    if (!edit.username?.trim()) return toast("请输入用户名", "error");
    if (!edit.id && !edit.password) return toast("请输入初始密码", "error");
    try {
      if (edit.id) await api(`/admin/users/${edit.id}`, { method: "PUT", body: edit });
      else await api("/admin/users", { method: "POST", body: edit });
      toast("已保存", "ok"); setEdit(null); load();
    } catch (e) { toast(e.message, "error"); }
  };

  const saveLevel = async () => {
    if (!editLevel.name?.trim()) return toast("请输入等级名称", "error");
    try {
      if (editLevel.id) await api(`/admin/levels/${editLevel.id}`, { method: "PUT", body: editLevel });
      else await api("/admin/levels", { method: "POST", body: editLevel });
      toast("已保存", "ok"); setEditLevel(null); load();
    } catch (e) { toast(e.message, "error"); }
  };

  const doDeleteUser = async () => {
    try { await api(`/admin/users/${remove.id}`, { method: "DELETE" }); toast("已删除", "ok"); setRemove(null); load(); }
    catch (e) { toast(e.message, "error"); }
  };

  return (
    <>
      <SubHeader
        title="用户管理"
        onBack={onBack}
        action={
          <button className="link small" onClick={() => tab === "users"
            ? setEdit({ username: "", nickname: "", password: "", role: "user", level_id: levels[0]?.id || null })
            : setEditLevel({ name: "", min_minutes: 0, max_minutes: 10, text_color: "#6B7280", is_default: 0 })}>
            新增
          </button>
        }
      />
      <div className="page-plain">
        <div className="sub-tabs">
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>用户列表</button>
          <button className={tab === "levels" ? "active" : ""} onClick={() => setTab("levels")}>等级配置</button>
        </div>

        {tab === "users" ? (
          !users ? <div className="loading-screen"><Spinner /></div> : users.length === 0 ? <Empty icon={<UserRound size={26} />} text="暂无用户资料" /> : (
            <div className="list-card">
              {users.map((u) => (
                <div className="list-row" key={u.id}>
                  <Avatar user={u} size={38} />
                  <div className="grow">
                    <div className="t">{u.nickname || u.username} {u.role === "admin" && <ShieldCheck size={13} color="#8b5cf6" style={{ verticalAlign: -1 }} />}</div>
                    <div className="m">@{u.username} · 总学时 {fmtWatch(u.total_watch_seconds)}</div>
                  </div>
                  <span className="badge" style={{ color: levelColor(u.level_id) }}>{levelName(u.level_id)}</span>
                  <div className="ops">
                    <button className="icon-btn" onClick={() => setEdit({ ...u, password: "" })}><Pencil size={15} /></button>
                    {u.id !== me?.id && <button className="icon-btn" style={{ color: "var(--danger)" }} onClick={() => setRemove(u)}><Trash2 size={15} /></button>}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="list-card">
            {levels.map((l) => (
              <div className="list-row" key={l.id}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: l.text_color }} />
                <div className="grow">
                  <div className="t" style={{ color: l.text_color }}>{l.name} {l.is_default ? <span className="badge" style={{ marginLeft: 6 }}>默认</span> : null}</div>
                  <div className="m">{l.min_minutes} ~ {l.max_minutes} 分钟</div>
                </div>
                <div className="ops">
                  <button className="icon-btn" onClick={() => setEditLevel(l)}><Pencil size={15} /></button>
                  <button className="icon-btn" style={{ color: "var(--danger)" }} onClick={async () => {
                    try { await api(`/admin/levels/${l.id}`, { method: "DELETE" }); load(); } catch (e) { toast(e.message, "error"); }
                  }}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {edit && (
        <Modal title={edit.id ? "编辑用户" : "新增用户"} onClose={() => setEdit(null)} footer={<>
          <button className="btn" onClick={() => setEdit(null)}>取消</button>
          <button className="btn btn-primary" onClick={saveUser}>保存</button>
        </>}>
          <div className="field"><label>用户名</label><input className="input" value={edit.username} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></div>
          <div className="field"><label>昵称</label><input className="input" value={edit.nickname || ""} onChange={(e) => setEdit({ ...edit, nickname: e.target.value })} /></div>
          <div className="field"><label>{edit.id ? "重置密码" : "初始密码"}</label><input className="input" type="password" placeholder={edit.id ? "留空则不修改" : ""} value={edit.password || ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></div>
          <div className="field">
            <label>角色</label>
            <select className="select" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div className="field">
            <label>等级</label>
            <select className="select" value={edit.level_id || ""} onChange={(e) => setEdit({ ...edit, level_id: Number(e.target.value) })}>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </Modal>
      )}

      {editLevel && (
        <Modal title={editLevel.id ? "编辑等级" : "新增等级"} onClose={() => setEditLevel(null)} footer={<>
          <button className="btn" onClick={() => setEditLevel(null)}>取消</button>
          <button className="btn btn-primary" onClick={saveLevel}>保存</button>
        </>}>
          <div className="field"><label>等级名称</label><input className="input" value={editLevel.name} onChange={(e) => setEditLevel({ ...editLevel, name: e.target.value })} /></div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field grow"><label>最少分钟</label><input className="input" type="number" value={editLevel.min_minutes} onChange={(e) => setEditLevel({ ...editLevel, min_minutes: Number(e.target.value) })} /></div>
            <div className="field grow"><label>最多分钟</label><input className="input" type="number" value={editLevel.max_minutes} onChange={(e) => setEditLevel({ ...editLevel, max_minutes: Number(e.target.value) })} /></div>
          </div>
          <div className="field"><label>文字颜色</label><input className="input" type="color" value={editLevel.text_color} onChange={(e) => setEditLevel({ ...editLevel, text_color: e.target.value })} style={{ height: 42, padding: 6 }} /></div>
          <div className="row"><span className="grow small">设为默认等级</span><Switch checked={!!editLevel.is_default} onChange={(v) => setEditLevel({ ...editLevel, is_default: v ? 1 : 0 })} /></div>
        </Modal>
      )}

      {remove && <Confirm title="删除用户" text={`确定删除用户「${remove.nickname || remove.username}」吗？`} onClose={() => setRemove(null)} onOk={doDeleteUser} />}
    </>
  );
}
