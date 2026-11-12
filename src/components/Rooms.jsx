import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Video, Plus, KeyRound, Users, Radio } from "lucide-react";
import { api, fmtDuration } from "../api.js";
import { useAuth } from "../App.jsx";
import { Modal, useToast, Empty, Spinner } from "./ui.jsx";

export default function Rooms() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [create, setCreate] = useState(false);
  const [join, setJoin] = useState(null);
  const [code, setCode] = useState("");
  const [form, setForm] = useState({ name: "", course_id: "" });
  const [courses, setCourses] = useState([]);
  const [joining, setJoining] = useState(false);

  const load = () => api("/rooms").then(setRooms).catch(() => setRooms([]));
  useEffect(() => {
    load();
    api("/courses").then(setCourses).catch(() => {});
  }, []);

  const doCreate = async () => {
    if (!form.name.trim()) return toast("请输入房间名称", "error");
    try {
      const r = await api("/rooms", { method: "POST", body: form });
      toast(`房间已创建，口令 ${r.code}`, "ok");
      setCreate(false);
      navigate(`/watch-party/${r.id}`);
    } catch (e) { toast(e.message, "error"); }
  };

  const doJoin = async () => {
    if (!join) return;
    setJoining(true);
    try {
      await api(`/rooms/${join.id}/verify`, { method: "POST", body: { code } });
      navigate(`/watch-party/${join.id}`);
    } catch (e) { toast(e.message, "error"); }
    setJoining(false);
  };

  return (
    <div>
      <div className="section-head" style={{ marginTop: 8 }}>
        <div>
          <h2>放映大厅</h2>
          <p>和朋友一起同步观看、实时聊天</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setCreate(true)}><Plus size={15} /> 创建房间</button>
      </div>

      {!rooms ? <div className="row" style={{ justifyContent: "center", padding: 40 }}><Spinner /></div>
        : rooms.length === 0 ? <Empty icon={<Video size={28} />} text="暂无放映房间，创建一个吧" />
          : rooms.map((r) => (
            <div className="exam-card" key={r.id} style={{ cursor: "pointer" }} onClick={() => { setJoin(r); setCode(""); }}>
              <div className="exam-icon" style={{ background: "var(--purple-soft)", color: "var(--purple)" }}><Radio size={22} /></div>
              <div className="exam-body">
                <h3>{r.name}</h3>
                <div className="meta">
                  <span>房主 {r.host?.nickname || r.host?.username}</span>
                  <span><Users size={12} /> {r.member_count} 人在线</span>
                  {r.material && <span>{r.material.title}</span>}
                  {r.is_playing ? <span className="badge badge-green">播放中</span> : <span className="badge">未开始</span>}
                </div>
              </div>
              <div className="exam-actions">
                <button className="btn btn-sm btn-soft"><KeyRound size={13} /> 口令进入</button>
                {r.host_id === user?.id && <span className="muted" style={{ fontSize: 11 }}>口令 {r.code}</span>}
              </div>
            </div>
          ))}

      {create && (
        <Modal title="创建放映房间" onClose={() => setCreate(false)} footer={<>
          <button className="btn" onClick={() => setCreate(false)}>取消</button>
          <button className="btn btn-primary" onClick={doCreate}>创建并进入</button>
        </>}>
          <div className="field"><label>房间名称</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：周末一起看电影" /></div>
          <div className="field">
            <label>选择课程（可选）</label>
            <select className="select" value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })}>
              <option value="">不关联课程</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <p className="muted small">创建后会生成 6 位房间口令，分享给朋友即可加入。</p>
        </Modal>
      )}

      {join && (
        <Modal title="进入放映房间" onClose={() => setJoin(null)} footer={<>
          <button className="btn" onClick={() => setJoin(null)}>取消</button>
          <button className="btn btn-primary" onClick={doJoin} disabled={joining}>{joining ? "验证中..." : "进入房间"}</button>
        </>}>
          <p style={{ fontSize: 14 }}>{join.name}</p>
          <div className="field">
            <label><KeyRound size={12} /> 房间口令</label>
            <div className="code-box"><input className="input" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6 位数字" /></div>
          </div>
          {join.host_id === user?.id && <p className="muted small">你是房主，口令是 <b>{join.code}</b></p>}
        </Modal>
      )}
    </div>
  );
}
