package main

import (
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/0xUnixIO/incus-panel/internal/api"
	"github.com/0xUnixIO/incus-panel/internal/incus"
	"github.com/0xUnixIO/incus-panel/internal/static"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Version is injected at build time via -ldflags "-X main.Version=v1.2.3"
var Version = "dev"

func main() {
	addr := flag.String("addr", ":8080", "监听地址")
	socketPath := flag.String("socket", "/var/lib/incus/unix.socket", "Incus Unix socket 路径")
	version := flag.Bool("version", false, "打印版本")
	flag.Parse()

	if *version {
		log.Printf("incus-panel %s", Version)
		return
	}

	client, err := incus.NewClient(*socketPath)
	if err != nil {
		log.Fatalf("连接 Incus 失败: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)

	api.Register(r, client)

	r.Handle("/*", spaHandler(getStaticFS()))

	log.Printf("incus-panel %s @ %s", Version, *addr)
	if err := http.ListenAndServe(*addr, r); err != nil {
		log.Fatal(err)
	}
}

// getStaticFS 优先使用 STATIC_DIR 环境变量（开发模式），否则使用嵌入的静态文件
func getStaticFS() http.FileSystem {
	if p := os.Getenv("STATIC_DIR"); p != "" {
		return http.Dir(p)
	}
	sub, err := fs.Sub(static.FS, "dist")
	if err != nil {
		log.Fatal("static embed 加载失败:", err)
	}
	return http.FS(sub)
}

// spaHandler 对未知路径 fallback 到 index.html，支持 React Router 客户端路由
func spaHandler(fsys http.FileSystem) http.HandlerFunc {
	fileServer := http.FileServer(fsys)
	return func(w http.ResponseWriter, r *http.Request) {
		f, err := fsys.Open(r.URL.Path)
		if err != nil {
			// 文件不存在，返回 index.html（SPA 路由处理）
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	}
}
