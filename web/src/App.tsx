import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import InstancesPage from "./pages/InstancesPage";
import InstanceDetailPage from "./pages/InstanceDetailPage";
import ConsolePage from "./pages/ConsolePage";
import ImagesPage from "./pages/ImagesPage";
import NetworksPage from "./pages/NetworksPage";
import StoragePage from "./pages/StoragePage";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      <Toaster position="top-right" theme="dark" richColors />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* 控制台独占全屏，不套 Layout */}
        <Route
          path="/instances/:name/console"
          element={
            <PrivateRoute>
              <ConsolePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/instances" replace />} />
          <Route path="instances" element={<InstancesPage />} />
          <Route path="instances/:name" element={<InstanceDetailPage />} />
          <Route path="images" element={<ImagesPage />} />
          <Route path="networks" element={<NetworksPage />} />
          <Route path="storage" element={<StoragePage />} />
        </Route>
      </Routes>
    </>
  );
}
