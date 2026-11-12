import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Sun, Settings, Tags, Users, BarChart3, BookOpen, History, Info, LogOut, ChevronRight,
  FolderCog, Pencil,
} from "lucide-react";
import { api, fmtWatch } from "../api.js";
import { useAuth } from "../App.jsx";
import { Avatar, Switch, Modal, useToast } from "../components/ui.jsx";
import SettingsView from "./profile/Settings.jsx";
import CategoriesView from "./profile/Categories.jsx";
import GroupsView from "./profile/Groups.jsx";
import UsersView from "./profile/Users.jsx";
import AdminCoursesView from "./profile/AdminCourses.jsx";
import HistoryView from "./profile/History.jsx";
import AboutView from "./profile/About.jsx";

const VIEWS = {
  settings: SettingsView,
  categories: CategoriesView,
  "course-groups": GroupsView,
  users: UsersView,
  courses: AdminCoursesView,
  history: HistoryView,
  about: AboutView,
};

export default function Profile() {
  const { user, isAdmin, theme, toggleTheme, logout, refreshUser, settings } = useAuth();
  const [params, setParams] = useSearchParams();
  const [profile, setProfile] = useState(user);
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState({ nickname: "", greeting_message: "", password: "" });
  const toast = useToast();
  const view = params.get("view");
  const ViewComponent = view ? VIEWS[view] : null;

  const load = () => api("/user/profile").then((p) => { setProfile(p); refreshUser(); }).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { setProfile(user); }, [user]);

  const openEdit = () => {
    setEdit({ nickname: profile?.nickname || "", greeting_message: profile?.greeting_message || "", password: "" });
    setEditOpen(true);
  };

  const saveProfile = async () => {
    try {
      await api("/user/profile", { method: "PUT", body: { nickname: edit.nickname, greeting_message: edit.greeting_message } });
      if (edit.password) await api("/user/password", { method: "POST", body: { oldPassword: edit.current, newPassword: edit.password } });
      toast("资料已更新", "ok");
      setEditOpen(false);
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  if (ViewComponent) {
    return <ViewComponent onBack={() => setParams({})} />;
  }

  const menu = [
    { view: "settings", label: "系统设置", icon: Settings, admin: true },
    { view: "categories", label: "分类管理", icon: Tags, admin: true },
    { view: "course-groups", label: "课程组管理", icon: FolderCog, admin: true },
    { view: "users", label: "用户管理", icon: Users, admin: true },
    { view: "watch-ranking", label: "观看统计", icon: BarChart3, admin: true, link: "/watch-ranking" },
    { view: "courses", label: "课程管理", icon: BookOpen, admin: true },
    { view: "history", label: "历史数据", icon: History, admin: false },
    { view: "about", label: "关于应用", icon: Info, admin: false },
  ].filter((m) => !m.admin || isAdmin);

  return (
    <div className="page">
      <div className="card profile-hero" onClick={openEdit} style={{ marginTop: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
          <Avatar user={profile} size={58} />
          {isAdmin && <span className="badge badge-purple" style={{ fontSize: 10, padding: "1px 7px" }}>管理员</span>}
        </div>
        <div className="grow">
          <div className="name-line">
            <h2>{profile?.nickname || profile?.username}</h2>
            <span className="badge" style={{ color: profile?.level_color }}>{profile?.level_name || "一级学员"}</span>
          </div>
          <div className="sub">{profile?.username}</div>
          <div className="hours">总学时：{fmtWatch(profile?.total_watch_seconds || 0)}</div>
        </div>
        <ChevronRight size={18} className="chev" />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="toggle-row">
          <Sun size={18} color="var(--muted-2)" />
          <span className="label">外观</span>
          <Switch checked={theme === "dark"} onChange={toggleTheme} />
        </div>
      </div>

      <div className="section-label">{isAdmin ? "管理控制台" : "更多"}</div>
      <div className="menu-card">
        {menu.map((m) => (
          <button key={m.view} className="menu-row" onClick={() => m.link ? navigate(m.link) : setParams({ view: m.view })}>
            <span className="mi"><m.icon size={18} /></span>
            <span className="label">{m.label}</span>
            <ChevronRight size={17} className="chev" />
          </button>
        ))}
      </div>

      <div className="menu-card" style={{ marginTop: 16 }}>
        <button className="menu-row danger" onClick={logout}><LogOut size={16} /> 退出登录</button>
      </div>

      <p className="muted small" style={{ textAlign: "center", marginTop: 18 }}>轻课堂 Lite Class v{settings.version}</p>

      {editOpen && (
        <Modal title="编辑资料" onClose={() => setEditOpen(false)} footer={<>
          <button className="btn" onClick={() => setEditOpen(false)}>取消</button>
          <button className="btn btn-primary" onClick={saveProfile}>保存</button>
        </>}>
          <div className="row" style={{ gap: 14 }}>
            <Avatar user={profile} size={56} />
            <label className="btn btn-sm">
              更换头像
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData(); fd.append("file", file);
                try {
                  const r = await api("/upload/avatar", { method: "POST", form: fd });
                  setProfile((p) => ({ ...p, avatar: r.url }));
                  refreshUser();
                  toast("头像已更新", "ok");
                } catch (err) { toast(err.message, "error"); }
              }} />
            </label>
          </div>
          <div className="field"><label>昵称</label><input className="input" value={edit.nickname} onChange={(e) => setEdit({ ...edit, nickname: e.target.value })} /></div>
          <div className="field"><label>问候语</label><input className="input" value={edit.greeting_message} onChange={(e) => setEdit({ ...edit, greeting_message: e.target.value })} /></div>
          <div className="field"><label>原密码（修改密码时填写）</label><input className="input" type="password" value={edit.current || ""} onChange={(e) => setEdit({ ...edit, current: e.target.value })} /></div>
          <div className="field"><label>新密码</label><input className="input" type="password" placeholder="不修改请留空" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}
