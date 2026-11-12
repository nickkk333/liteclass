import React, { useEffect, useState } from "react";
import { Plus, FolderCog, Pencil, Trash2 } from "lucide-react";
import { api } from "../../api.js";
import { useToast, Modal, Confirm, Empty, Spinner } from "../../components/ui.jsx";
import SubHeader from "../../components/SubHeader.jsx";

export default function GroupsView({ onBack }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [remove, setRemove] = useState(null);

  const load = () => api("/admin/course-groups").then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!edit.name?.trim()) return toast("请输入课程组名称", "error");
    try {
      let id = edit.id;
      if (id) await api(`/admin/course-groups/${id}`, { method: "PUT", body: edit });
      else { const r = await api("/admin/course-groups", { method: "POST", body: edit }); id = r.id; }
      const paths = String(edit.pathsText || "").split("\n").map((s) => s.trim()).filter(Boolean);
      await api(`/admin/course-groups/${id}/permissions`, { method: "POST", body: { paths } });
      toast("已保存", "ok");
      setEdit(null);
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  const doDelete = async () => {
    try { await api(`/admin/course-groups/${remove.id}`, { method: "DELETE" }); toast("已删除", "ok"); setRemove(null); load(); }
    catch (e) { toast(e.message, "error"); }
  };

  return (
    <>
      <SubHeader title="课程分组管理" onBack={onBack} action={<button className="link small" onClick={() => setEdit({ name: "", description: "", pathsText: "" })}>新增</button>} />
      <div className="page-plain">
        {!list ? <div className="loading-screen"><Spinner /></div> : list.length === 0 ? <Empty icon={<FolderCog size={26} />} text="暂无课程组" /> : (
          <div className="list-card">
            {list.map((g) => (
              <div className="list-row" key={g.id}>
                <span className="badge badge-purple" style={{ width: 30, height: 30, justifyContent: "center", borderRadius: 9 }}><FolderCog size={14} /></span>
                <div className="grow">
                  <div className="t">{g.name}</div>
                  <div className="m">{g.description || "暂无描述"} · {g.permissions?.length || 0} 条路径授权</div>
                </div>
                <div className="ops">
                  <button className="icon-btn" onClick={() => setEdit({
                    ...g, pathsText: (g.permissions || []).map((p) => p.path).join("\n"),
                  })}><Pencil size={15} /></button>
                  <button className="icon-btn" style={{ color: "var(--danger)" }} onClick={() => setRemove(g)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {edit && (
        <Modal title={edit.id ? "编辑课程组" : "新增课程组"} onClose={() => setEdit(null)} footer={<>
          <button className="btn" onClick={() => setEdit(null)}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </>}>
          <div className="field"><label>名称</label><input className="input" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
          <div className="field"><label>描述</label><input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
          <div className="field">
            <label>授权路径</label>
            <textarea className="textarea" placeholder={"每行一个路径，例如：\n/vol1/1000/Media/课程"} value={edit.pathsText || ""} onChange={(e) => setEdit({ ...edit, pathsText: e.target.value })} />
            <span className="hint">课程组内的用户可访问这些 NAS 路径下的课程资源</span>
          </div>
        </Modal>
      )}

      {remove && <Confirm title="删除课程组" text={`确定删除「${remove.name}」吗？`} onClose={() => setRemove(null)} onOk={doDelete} />}
    </>
  );
}
