package api

import (
	"github.com/0xUnixIO/incuspace/internal/api/handler"
	"github.com/0xUnixIO/incuspace/internal/auth"
	"github.com/0xUnixIO/incuspace/internal/incus"
	"github.com/0xUnixIO/incuspace/internal/sshkeys"
	"github.com/go-chi/chi/v5"
)

func Register(r chi.Router, client *incus.Client, keys *sshkeys.Store) {
	h := handler.New(client, keys)

	r.Route("/api/v1", func(r chi.Router) {
		// 公开路由
		r.Post("/auth/login", h.Login)

		// 需要认证的路由
		// WebSocket 控制台：浏览器 WS 无法设置 header，通过 query token 认证
		r.Get("/instances/{name}/console", h.Console)

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware)

			// 实例
			r.Get("/instances", h.ListInstances)
			r.Post("/instances", h.CreateInstance)
			r.Get("/instances/{name}", h.GetInstance)
			r.Patch("/instances/{name}/config", h.PatchInstanceConfig)
			r.Delete("/instances/{name}", h.DeleteInstance)
			r.Put("/instances/{name}/action", h.InstanceAction)
			r.Get("/instances/{name}/state", h.GetInstanceState)

			// 实例快照
			r.Get("/instances/{name}/snapshots", h.ListSnapshots)
			r.Post("/instances/{name}/snapshots", h.CreateSnapshot)
			r.Delete("/instances/{name}/snapshots/{snap}", h.DeleteSnapshot)
			r.Post("/instances/{name}/snapshots/{snap}/restore", h.RestoreSnapshot)

			// 镜像
			r.Get("/images", h.ListImages)
			r.Delete("/images/{fingerprint}", h.DeleteImage)
			r.Get("/images/remote", h.ListRemoteImages)
			r.Post("/images/pull", h.PullImage)

			// 网络
			r.Get("/networks", h.ListNetworks)
			r.Post("/networks", h.CreateNetwork)
			r.Delete("/networks/{name}", h.DeleteNetwork)

			// 存储池
			r.Get("/storage-pools", h.ListStoragePools)

			// 异步操作
			r.Get("/operations", h.ListOperations)

			// 文件管理
			r.Get("/instances/{name}/files", h.ListInstanceFiles)
			r.Get("/instances/{name}/files/download", h.DownloadInstanceFile)
			r.Post("/instances/{name}/files", h.UploadInstanceFile)
			r.Delete("/instances/{name}/files", h.DeleteInstanceFile)

			// SSH 公钥管理（面板全局）
			r.Get("/ssh-keys", h.ListSSHKeys)
			r.Post("/ssh-keys", h.AddSSHKey)
			r.Delete("/ssh-keys/{id}", h.DeleteSSHKey)

			// 实例 SSH 公钥（直接读写 authorized_keys）
			r.Get("/instances/{name}/ssh-keys", h.GetInstanceSSHKeys)
			r.Put("/instances/{name}/ssh-keys", h.PutInstanceSSHKeys)
		})
	})
}
