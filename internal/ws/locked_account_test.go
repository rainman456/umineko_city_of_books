package ws

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"

	"umineko_city_of_books/internal/authz"
	"umineko_city_of_books/internal/repository"
	"umineko_city_of_books/internal/session"
	"umineko_city_of_books/internal/settings"

	"github.com/fasthttp/websocket"
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type recordingGamePresence struct {
	mu     sync.Mutex
	inputs []uuid.UUID
}

func (r *recordingGamePresence) HandleClientJoin(context.Context, uuid.UUID, uuid.UUID) {}

func (r *recordingGamePresence) HandleClientLeave(uuid.UUID, uuid.UUID) {}

func (r *recordingGamePresence) HandleClientInput(userID, roomID uuid.UUID, payload json.RawMessage) {
	r.mu.Lock()
	r.inputs = append(r.inputs, roomID)
	r.mu.Unlock()
}

func (r *recordingGamePresence) HandleClientPing(uuid.UUID, int) {}

func (r *recordingGamePresence) inputCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.inputs)
}

// The locked flag lives on the user row and is only consulted by the HTTP middleware
// (internal/middleware/auth.go, "your account is locked", covered by
// TestRequireAuth at internal/middleware/auth_test.go:73). Nothing on the websocket path reads
// it: the upgrade asks the session manager for the token's user and the authz service whether the
// account is banned, and the periodic recheck does the same. This test pins that behaviour so the
// day a lock gate is added here it fails loudly, and it shows a socket that was already open can
// still reach the realtime game path.
func TestLockedAccountKeepsRealtimeGameAccess(t *testing.T) {
	// given a valid session for an account whose only restriction is the lock flag, which this
	// path never sees
	hub := NewHub()
	userID := uuid.New()
	gameRoomID := uuid.New()
	origin := "http://127.0.0.1:5173"

	repo := repository.NewMockSessionRepository(t)
	repo.EXPECT().GetUserID(mock.Anything, "locked-token").Return(userID, time.Now().Add(time.Hour), nil).Maybe()

	mgr := session.NewManager(repo, settings.NewMockService(t))
	authzSvc := authz.NewMockService(t)
	authzSvc.EXPECT().IsBanned(mock.Anything, userID).Return(false)

	presence := &recordingGamePresence{}

	app := fiber.New()
	app.Get("/ws", Handler(hub, mgr, authzSvc, nil, nil, presence, nil, func(context.Context) string {
		return origin
	}))

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go func() {
		_ = app.Listener(ln)
	}()
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = app.ShutdownWithContext(shutdownCtx)
	})

	// when the socket is opened with that session and the game input frames are sent
	url := "ws://" + ln.Addr().String() + "/ws?token=locked-token"
	conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{origin}})
	require.NoError(t, err, "a valid session must pass the upgrade; a refusal here means a gate was added")
	t.Cleanup(func() {
		_ = conn.Close()
	})

	require.NoError(t, conn.WriteJSON(map[string]any{
		"type": "game_room_join",
		"data": map[string]string{"room_id": gameRoomID.String()},
	}))
	require.NoError(t, conn.WriteJSON(map[string]any{
		"type": "game_room_input",
		"data": map[string]any{
			"room_id": gameRoomID.String(),
			"payload": map[string]int{"player": 1, "sequence": 2},
		},
	}))

	// then the input reaches the game service, exactly as it would for an unrestricted account
	require.Eventually(t, func() bool {
		return presence.inputCount() >= 1
	}, 3*time.Second, 25*time.Millisecond)
}
