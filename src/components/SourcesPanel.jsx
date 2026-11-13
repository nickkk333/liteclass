import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sourcesList, sourceSave, sourceTest, sourceConnect, sourceRemove } from "../api.js";
import { useToast } from "./ui.jsx";

const EMPTY = {
  id: "", kind: "local", name: "", path: "", url: "", host: "", port: 0,
  share: "", base_path: "", domain: "", username: "", password: "", insecure_tls: false,
};

/** 系统设置里的课程来源管理：本地目录 / WebDAV / SMB，密码只写不读。 */
export default function SourcesPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    try { setSources((await sourcesList()).sources || []); }
    catch (e) { setMessage(e.message); }
  };
  useEffect(() => { load(); }, []);

  const field = (key) => ({
    value: form[key] ?? "",
    onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value })),
  });
  const reset = () => { setForm(EMPTY); setEditing(false); setMessage(""); };

  const run = async (action, fn) => {
    setBusy(action);
    setMessage("");
    try { await fn(); }
    catch (e) { setMessage(e.message); }
    finally { setBusy(""); }
  };

  const submit = (event) => {
    event.preventDefault();
    run("save", async () => {
      await sourceSave(form, editing);
      toast(editing ? "课程来源已更新" : "课程来源已添加");
      reset();
      await load();
    });
  };

  const test = () => run("test", async () => {
    await sourceTest(form.id ? { ...form, id: form.id } : form);
    setMessage("连接成功，目录可访问。");
  });

  const connect = () => run("connect", async () => {
    const result = await sourceConnect({ ...form, load: true });
    toast(`连接成功（${result.action}）`);
    reset();
    await load();
    if (result.course?.id) navigate(`/course/${result.course.id}`);
  });

  const edit = (source) => {
    setForm({ ...EMPTY, ...source, password: "" });
    setEditing(true);
    setMessage("");
  };

  const remove = (source) => run(`remove:${source.id}`, async () => {
    if (!window.confirm(`删除课程来源「${source.name}」？已创建的课程章节不会删除原文件。`)) return;
    await sourceRemove(source.id);
    await load();
  });

  return (
    <div className="sources-panel">
      <h3>课程来源</h3>
      <p className="muted small">
        添加本地目录、WebDAV 或 SMB 共享后，可在「新增课程 → 选择文件夹」里直接进入。
        密码只保存在服务端，不会回传到浏览器；编辑时留空表示沿用原密码。
      </p>

      <div className="source-list">
        {sources.length ? sources.map((source) => (
          <div className="source-item" key={source.id}>
            <div className="grow">
              <div className="source-name">{source.name} <span className="tag tiny">{source.kind.toUpperCase()}</span></div>
              <div className="muted tiny ellipsis">
                {source.path || source.url || `${source.host}/${source.share}${source.base_path ? `/${source.base_path}` : ""}`}
                {source.has_password ? " · 已保存密码" : ""}
              </div>
              <div className="muted tiny">虚拟路径：{source.root}</div>
            </div>
            <button type="button" className="btn tiny ghost" onClick={() => edit(source)}>编辑</button>
            <button type="button" className="btn tiny ghost" disabled={busy === `remove:${source.id}`} onClick={() => remove(source)}>删除</button>
          </div>
        )) : <div className="muted small">还没有课程来源。</div>}
      </div>

      <form className="source-form" onSubmit={submit}>
        <div className="source-grid">
          <label>类型
            <select className="input" {...field("kind")}>
              <option value="local">本地目录</option>
              <option value="webdav">WebDAV</option>
              <option value="smb">SMB 共享</option>
            </select>
          </label>
          <label>名称（可留空自动生成）
            <input className="input" placeholder="例如：网盘课程" {...field("name")} />
          </label>

          {form.kind === "local" ? (
            <label className="span-2">本地目录绝对路径
              <input className="input" placeholder="D:/Courses 或 /vol1/1000/Courses" {...field("path")} />
            </label>
          ) : null}

          {form.kind === "webdav" ? (
            <>
              <label className="span-2">WebDAV 地址
                <input className="input" placeholder="https://nas.example.com/dav/courses" {...field("url")} />
              </label>
              <label>用户名<input className="input" {...field("username")} /></label>
              <label>密码<input className="input" type="password" placeholder={editing ? "留空保持原密码" : ""} {...field("password")} /></label>
              <label className="check-row small span-2">
                <input type="checkbox" checked={!!form.insecure_tls} onChange={(e) => setForm((f) => ({ ...f, insecure_tls: e.target.checked }))} />
                允许自签名 HTTPS 证书
              </label>
            </>
          ) : null}

          {form.kind === "smb" ? (
            <>
              <label>主机<input className="input" placeholder="192.168.1.10" {...field("host")} /></label>
              <label>端口（默认 445）<input className="input" type="number" min="0" {...field("port")} /></label>
              <label>共享名<input className="input" placeholder="courses" {...field("share")} /></label>
              <label>共享内子目录<input className="input" placeholder="课程/2026" {...field("base_path")} /></label>
              <label>域（可空）<input className="input" {...field("domain")} /></label>
              <label>用户名<input className="input" {...field("username")} /></label>
              <label>密码<input className="input" type="password" placeholder={editing ? "留空保持原密码" : ""} {...field("password")} /></label>
              <label className="span-2">或已挂载的 UNC / 本地路径（优先使用，稳定性更好）
                <input className="input" placeholder="\\\\192.168.1.10\\courses 或 /mnt/courses" {...field("path")} />
              </label>
            </>
          ) : null}
        </div>

        {message ? <div className="hint small">{message}</div> : null}

        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary" type="submit" disabled={busy === "save"}>{editing ? "保存修改" : "添加来源"}</button>
          <button className="btn" type="button" disabled={busy === "test"} onClick={test}>测试连接</button>
          <button className="btn" type="button" disabled={busy === "connect"} onClick={connect}>连接并作为课程打开</button>
          {editing ? <button className="btn ghost" type="button" onClick={reset}>取消编辑</button> : null}
        </div>
      </form>
    </div>
  );
}
