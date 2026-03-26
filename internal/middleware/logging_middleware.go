package middleware

import (
	"log"
	"net/http"
	"net/url"
	"runtime/debug"
	"strings"
	"time"
)

func redactHeaders(headers http.Header) http.Header {
	redactedHeaders := make(http.Header)
	for key, values := range headers {
		if strings.EqualFold(key, "Authorization") || strings.EqualFold(key, "expo-session") {
			redactedHeaders[key] = []string{"REDACTED"}
		} else {
			redactedHeaders[key] = values
		}
	}
	return redactedHeaders
}

func redactQuery(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}

	queryValues, err := url.ParseQuery(rawQuery)
	if err != nil {
		return rawQuery
	}

	for key := range queryValues {
		if strings.EqualFold(key, "token") {
			queryValues.Set(key, "REDACTED")
		}
	}

	return queryValues.Encode()
}

func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/hc" || r.URL.Path == "/metrics" || r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()

		safeHeaders := redactHeaders(r.Header)
		safeQuery := redactQuery(r.URL.RawQuery)

		log.Printf("Started %s %s with query: %s and headers: %v", r.Method, r.RequestURI, safeQuery, safeHeaders)

		recorder := &statusRecorder{ResponseWriter: w, statusCode: http.StatusOK}

		defer func() {
			if err := recover(); err != nil {
				log.Printf("Panic recovered during %s %s\nQuery: %s\nHeaders: %v\nError: %v\nStack Trace:\n%s",
					r.Method, r.RequestURI, safeQuery, safeHeaders, err, debug.Stack())
				http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			}
		}()

		next.ServeHTTP(recorder, r)

		if recorder.statusCode >= 500 {
			log.Printf("Error detected: %s %s returned status %d", r.Method, r.RequestURI, recorder.statusCode)
		}
		log.Printf("Completed %s %d in %v", r.RequestURI, recorder.statusCode, time.Since(start))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code)
}
