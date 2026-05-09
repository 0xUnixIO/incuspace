package sshkeys

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"sync"
	"time"
)

type Key struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	PublicKey string    `json:"public_key"`
	CreatedAt time.Time `json:"created_at"`
}

type Store struct {
	mu   sync.RWMutex
	path string
	keys []Key
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, keys: []Key{}}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, &s.keys); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) List() []Key {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Key, len(s.keys))
	copy(out, s.keys)
	return out
}

func (s *Store) Add(name, publicKey string) (Key, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return Key{}, err
	}
	k := Key{ID: hex.EncodeToString(b), Name: name, PublicKey: publicKey, CreatedAt: time.Now()}
	s.keys = append(s.keys, k)
	return k, s.save()
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, k := range s.keys {
		if k.ID == id {
			s.keys = append(s.keys[:i], s.keys[i+1:]...)
			return s.save()
		}
	}
	return nil
}

func (s *Store) GetByIDs(ids []string) []Key {
	s.mu.RLock()
	defer s.mu.RUnlock()
	set := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	var out []Key
	for _, k := range s.keys {
		if _, ok := set[k.ID]; ok {
			out = append(out, k)
		}
	}
	return out
}

func (s *Store) save() error {
	data, err := json.MarshalIndent(s.keys, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0600)
}
