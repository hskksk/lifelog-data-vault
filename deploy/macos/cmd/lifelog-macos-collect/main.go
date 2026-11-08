package main

import (
	"os"

	"github.com/hskksk/lifelog-data-vault/deploy/macos/internal/collect"
)

func main() {
	os.Exit(collect.Main(os.Args[1:]))
}
