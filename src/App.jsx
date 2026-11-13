import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, Outlet, NavLink } from "react-router-dom";
import { Home as HomeIcon, BookOpen, User as UserIcon } from "lucide-react";
import { api, getToken, setToken } from "./api.js";
import { ToastProvider, Loading } from "./components/ui.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import Courses from "./pages/Courses.jsx";
import CourseDetail from "./pages/CourseDetail.jsx";
import ManageCourse from "./pages/ManageCourse.jsx";
import Profile from "./pages/Profile.jsx";
import Ranking from "./pages/Ranking.jsx";
import RankingUser from "./pages/RankingUser.jsx";
import WatchParty from "./pages/WatchParty.jsx";
import CastBar from "./components/CastBar.jsx";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const DEFAULT_SETTINGS = {
  allow_registration: false,
  allow_course_creation: true,
  max_material_size: 100,
  max_course_size: 1024,
  enable_transcoding: true,
  show_watch_ranking_on_home: false,
  version: "1.1.6",
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [theme, setThemeState] = useState(() => localStorage.getItem("liteclass.theme") || "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("liteclass.theme", theme);
  }, [theme]);

  useEffect(() => {
    api("/settings/public").then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api("/auth/verify")
      .then((r) => setUser(r.user))
      .catch(() => setToken(""))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUnauth = () => setUser(null);
    window.addEventListener("liteclass:unauthorized", onUnauth);
    return () => window.removeEventListener("liteclass:unauthorized", onUnauth);
  }, []);

  const refreshUser = async () => {
    try { setUser(await api("/user/profile")); } catch {}
  };

  const login = async (username, password) => {
    const r = await api("/auth/login", { method: "POST", body: { username, password } });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };

  const logout = () => {
    setToken("");
    setUser(null);
    window.location.href = "/login";
  };

  const value = {
    user, setUser, loading, login, logout, refreshUser, settings, setSettings,
    theme, toggleTheme: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    isAdmin: user?.role === "admin",
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function TabLayout() {
  return (
    <>
      <Outlet />
      <nav className="bottom-nav">
        <div className="nav-inner">
          <NavLink to="/" end><HomeIcon /><span>首页</span></NavLink>
          <NavLink to="/courses"><BookOpen /><span>课程</span></NavLink>
          <NavLink to="/profile"><UserIcon /><span>我的</span></NavLink>
        </div>
      </nav>
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <div className="app-shell">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected><TabLayout /></Protected>}>
            <Route path="/" element={<Home />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="/course/:id" element={<Protected><CourseDetail /></Protected>} />
          <Route path="/course/:id/manage" element={<Protected><ManageCourse /></Protected>} />
          <Route path="/watch-ranking" element={<Protected><Ranking /></Protected>} />
          <Route path="/watch-ranking/user/:userId" element={<Protected><RankingUser /></Protected>} />
          <Route path="/watch-party/:roomId" element={<Protected><WatchParty /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <CastBar />
      </div>
    </ToastProvider>
  );
}
