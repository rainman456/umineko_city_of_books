package logger

import (
	"context"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"umineko_city_of_books/internal/config"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/trace"
)

var (
	Log      zerolog.Logger
	initOnce sync.Once
)

func Init(level string) {
	initOnce.Do(func() {
		Log = zerolog.New(newWriter()).With().Timestamp().Logger()
	})

	SetLevel(level)
}

func SetLevel(level string) {
	parsed, err := zerolog.ParseLevel(level)
	if err != nil {
		parsed = zerolog.InfoLevel
	}

	zerolog.SetGlobalLevel(parsed)
}

func Ctx(ctx context.Context) *zerolog.Logger {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		return &Log
	}

	traced := Log.With().
		Str("trace_id", sc.TraceID().String()).
		Str("span_id", sc.SpanID().String()).
		Logger()

	return &traced
}

func newWriter() io.Writer {
	if strings.EqualFold(os.Getenv("LOG_FORMAT"), "json") {
		return os.Stdout
	}

	return zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.DateTime}
}

type SettingsListener struct{}

func NewSettingsListener() *SettingsListener {
	return &SettingsListener{}
}

func (l *SettingsListener) OnSettingChanged(key config.SiteSettingKey, value string) {
	if key != config.SettingLogLevel.Key {
		return
	}

	SetLevel(value)
	Log.Info().Str("level", value).Msg("log level changed")
}
