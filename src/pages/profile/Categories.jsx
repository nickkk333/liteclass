import React, { useEffect, useState } from "react";
import { Plus, Tag, Pencil, Trash2 } from "lucide-react";
import { api } from "../../api.js";
import { useToast, Modal, Confirm, Empty, Spinner } from "../../components/ui.jsx";
import SubHeader from "../../components/SubHeader.jsx";

export default function CategoriesView({ onBack }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [remove, setRemove] = useState(null);

  const load = () => api("/categories").then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!edit.name?.trim()) return toast("请输入分类名称", "error");
    try {
      if (edit.id) await api(`/categories/${edit.id}`, { method: "PUT", body: { name: edit.name } });
      else await api("/categories", { method: "POST", body: { name: edit.name } });
      toast("已保存", "ok");
      setEdit(null);
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  const doDelete = async () => {
    try {
      await api(`/categories/${remove.id}`, { method: "DELETE" });
      toast("已删除", "ok");
      setRemove(null);
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <>
      <SubHeader title="分类管理" onBack={onBack} action={<button className="link small" onClick={() => setEdit({ name: "" })}>新增</button>} />
      <div className="page-plain">
        {!list ? <div className="loading-screen"><Spinner /></div> : list.length === 0 ? <Empty icon={<Tag size={26} />} text="暂无分类" /> : (
          <div className="list-card">
            {list.map((c) => (
              <div className="list-row" key={c.id}>
                <span className="badge badge-blue" style={{ width: 30, height: 30, justifyContent: "center", borderRadius: 9 }}><Tag size={14} /></span>
                <div className="grow">
                  <div className="t">{c.name}</div>
                  <div className="m">{c.course_count} 门课程</div>
                </div>
                <div className="ops">
                  <button className="icon-btn" onClick={() => setEdit({ ...c })}><Pencil size={15} /></button>
                  <button className="icon-btn" style={{ color: "var(--danger)" }} onClick={() => setRemove(c)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {edit && (
        <Modal title={edit.id ? "编辑分类" : "新增分类"} onClose={() => setEdit(null)} footer={<>
          <button className="btn" onClick={() => setEdit(null)}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </>}>
          <div className="field"><label>分类名称</label><input className="input" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
        </Modal>
      )}

      {remove && <Confirm title="删除分类" text={`确定删除「${remove.name}」吗？该分类下的课程会移动到「未分类」。`} onClose={() => setRemove(null)} onOk={doDelete} />}
    </>
  );
}
