import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { GraduationCap, User, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useAuth } from "../App.jsx";
import { api, setToken } from "../api.js";
import { Modal } from "../components/ui.jsx";

export default function Login() {
  const { user, login, settings, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [register, setRegister] = useState(false);
  const [reg, setReg] = useState({ username: "", password: "", nickname: "" });
  const [regError, setRegError] = useState("");

  if (user) return <Navigate to={location.state?.from || "/"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError("请输入用户名和密码"); return; }
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doRegister = async () => {
    setRegError("");
    if (!reg.username.trim() || !reg.password) { setRegError("请填写用户名和密码"); return; }
    try {
      const r = await api("/auth/register", { method: "POST", body: reg });
      setToken(r.token);
      setUser(r.user);
      navigate("/", { replace: true });
    } catch (err) {
      setRegError(err.message);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><GraduationCap size={46} strokeWidth={1.9} /></div>
        <h1>轻课堂 Lite Class</h1>
        <p className="sub">轻量级私有云课堂</p>

        <form className="login-form" onSubmit={submit}>
          <label className="login-input">
            <User size={17} />
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" autoComplete="username" />
          </label>
          <label className="login-input">
            <Lock size={17} />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={show ? "text" : "password"}
              placeholder="密码"
              autoComplete="current-password"
            />
            <button type="button" className="eye" onClick={() => setShow((s) => !s)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !username.trim() || !password}>
            {busy ? "登录中..." : "登录"} <ArrowRight size={16} />
          </button>
        </form>

        <p className="login-footer">
          {settings.allow_registration
            ? <button className="link" onClick={() => setRegister(true)}>注册新账号</button>
            : "暂未开放注册"}
        </p>
      </div>

      {register && (
        <Modal
          title="注册账号"
          onClose={() => setRegister(false)}
          footer={<>
            <button className="btn" onClick={() => setRegister(false)}>取消</button>
            <button className="btn btn-primary" onClick={doRegister}>注册</button>
          </>}
        >
          <div className="field"><label>用户名</label><input className="input" value={reg.username} onChange={(e) => setReg({ ...reg, username: e.target.value })} /></div>
          <div className="field"><label>昵称</label><input className="input" value={reg.nickname} onChange={(e) => setReg({ ...reg, nickname: e.target.value })} /></div>
          <div className="field"><label>密码</label><input className="input" type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} /></div>
          {regError && <p className="login-error">{regError}</p>}
        </Modal>
      )}
    </div>
  );
}
