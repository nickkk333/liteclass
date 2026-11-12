import React from "react";
import { GraduationCap } from "lucide-react";
import { useAuth } from "../../App.jsx";
import SubHeader from "../../components/SubHeader.jsx";

export default function AboutView({ onBack }) {
  const { settings } = useAuth();
  return (
    <>
      <SubHeader title="关于我们" onBack={onBack} />
      <div className="page-plain">
        <div className="card about-hero">
          <div className="about-logo"><GraduationCap size={42} strokeWidth={1.9} /></div>
          <h2>轻课堂</h2>
          <p>轻量级私有云课堂</p>
        </div>

        <div className="card" style={{ padding: "6px 18px", marginTop: 16 }}>
          <div className="about-meta"><span className="muted">当前版本</span><span>v{settings.version}</span></div>
          <div className="about-meta"><span className="muted">开发者</span><span>落地长安</span></div>
          <div className="about-meta"><span className="muted">项目地址</span><span>github.com/liteclass</span></div>
        </div>

        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>赞赏支持</h3>
          <p className="muted small" style={{ marginTop: 6 }}>如果您觉得这个项目对您有帮助，欢迎请作者喝杯咖啡</p>
          <div className="qr-box">
            <div className="qr"><img className="img" src="/qr-wechat.svg" alt="微信赞赏码" style={{ background: "#fff", objectFit: "contain" }} />微信</div>
            <div className="qr"><img className="img" src="/qr-alipay.svg" alt="支付宝赞赏码" style={{ background: "#fff", objectFit: "contain" }} />支付宝</div>
          </div>
        </div>

        <p className="muted small" style={{ textAlign: "center", marginTop: 22 }}>专为 NAS 用户打造的轻量级、多用户私有云学习管理系统。</p>
      </div>
    </>
  );
}
