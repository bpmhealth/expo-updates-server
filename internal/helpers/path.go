package helpers

import (
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"strings"
)

var ErrInvalidStoragePath = errors.New("invalid storage path")
var ErrPathEscapesBase = errors.New("path escapes base path")

func NormalizeStoragePath(rawPath string) (string, error) {
	trimmedPath := strings.TrimSpace(rawPath)
	if trimmedPath == "" {
		return "", fmt.Errorf("%w: empty path", ErrInvalidStoragePath)
	}

	normalizedPath := strings.ReplaceAll(trimmedPath, "\\", "/")
	if strings.HasPrefix(normalizedPath, "/") || path.IsAbs(normalizedPath) {
		return "", fmt.Errorf("%w: absolute paths are not allowed", ErrInvalidStoragePath)
	}

	cleanPath := path.Clean(normalizedPath)
	if cleanPath == "." || cleanPath == ".." || strings.HasPrefix(cleanPath, "../") {
		return "", fmt.Errorf("%w: path traversal is not allowed", ErrInvalidStoragePath)
	}

	return cleanPath, nil
}

func ResolvePathWithinBase(basePath string, parts ...string) (string, error) {
	absoluteBasePath, err := filepath.Abs(basePath)
	if err != nil {
		return "", err
	}

	targetPath := filepath.Clean(filepath.Join(append([]string{absoluteBasePath}, parts...)...))
	relativePath, err := filepath.Rel(absoluteBasePath, targetPath)
	if err != nil {
		return "", err
	}

	if relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %s", ErrPathEscapesBase, targetPath)
	}

	return targetPath, nil
}
