package main

import (
	"context"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/0xUnixIO/incuspace/internal/api"
	"github.com/0xUnixIO/incuspace/internal/db"
	"github.com/0xUnixIO/incuspace/internal/images"
	"github.com/0xUnixIO/incuspace/internal/incus"
	"github.com/0xUnixIO/incuspace/internal/instances"
	"github.com/0xUnixIO/incuspace/internal/plans"
	"github.com/0xUnixIO/incuspace/internal/quota"
	"github.com/0xUnixIO/incuspace/internal/sshkeys"
	"github.com/0xUnixIO/incuspace/internal/static"
	"github.com/0xUnixIO/incuspace/internal/users"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Version is injected at build time via -ldflags "-X main.Version=v1.2.3"
var Version = "dev"

func main() {
	exe, _ := os.Executable()
	defaultDataDir := filepath.Dir(exe)

	addr := flag.String("addr", ":8080", "监听地址")
	socketPath := flag.String("socket", "/var/lib/incus/unix.socket", "Incus Unix socket 路径")
	dataDir := flag.String("data-dir", defaultDataDir, "数据目录")
	version := flag.Bool("version", false, "打印版本")
	flag.Parse()

	if *version {
		log.Printf("incus-panel %s", Version)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL 未设置（例: postgres://user:pass@localhost/incuspace?sslmode=disable）")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatalf("迁移失败: %v", err)
	}

	usersRepo := users.NewRepo(pool)
	instsRepo := instances.NewRepo(pool, instances.PortPool{
		Start:            envInt("PORT_POOL_START", 30000),
		End:              envInt("PORT_POOL_END", 39999),
		PortsPerInstance: envInt("PORTS_PER_INSTANCE", 10),
	})
	plansRepo := plans.NewRepo(pool)
	allowedImagesRepo := images.NewRepo(pool)

	if err := bootstrapAdmin(ctx, usersRepo); err != nil {
		log.Fatalf("初始化管理员失败: %v", err)
	}

	client, err := incus.NewClient(*socketPath)
	if err != nil {
		log.Fatalf("连接 Incus 失败: %v", err)
	}

	keyStore, err := sshkeys.NewStore(filepath.Join(*dataDir, "ssh_keys.json"))
	if err != nil {
		log.Fatalf("初始化 SSH key 存储失败: %v", err)
	}

	quotaStore := quota.NewStore(pool)
	go quota.NewMonitor(quotaStore, instsRepo, client).Run(ctx)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)

	h := api.Register(r, client, keyStore, quotaStore, usersRepo, instsRepo, plansRepo, allowedImagesRepo)
	go h.ReconcilePlanLimits(context.Background())
	r.Handle("/*", spaHandler(getStaticFS()))

	log.Printf("incus-panel %s @ %s", Version, *addr)
	if err := http.ListenAndServe(*addr, r); err != nil {
		log.Fatal(err)
	}
}

func bootstrapAdmin(ctx context.Context, repo *users.Repo) error {
	n, err := repo.Count(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	user := os.Getenv("ADMIN_USER")
	pass := os.Getenv("ADMIN_PASS")
	if user == "" {
		user = "admin"
	}
	if pass == "" {
		pass = "admin"
		log.Println("⚠️ ADMIN_PASS 未设置，已使用默认密码 admin（请尽快通过面板修改）")
	}
	u, err := repo.Create(ctx, users.CreateInput{
		Username: user,
		Password: pass,
		Role:     users.RoleAdmin,
	})
	if err != nil {
		return err
	}
	log.Printf("✅ 已创建初始管理员: %s (id=%s)", u.Username, u.ID)
	return nil
}

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

func spaHandler(fsys http.FileSystem) http.HandlerFunc {
	fileServer := http.FileServer(fsys)
	return func(w http.ResponseWriter, r *http.Request) {
		f, err := fsys.Open(r.URL.Path)
		if err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	}
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
