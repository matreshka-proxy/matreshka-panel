package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"

	"filippo.io/age"

	"github.com/matreshka-proxy/matreshka-panel/agent/internal/policy"
)

const defaultSocket = "/run/matreshka/agent.sock"

type response struct {
	OK     bool   `json:"ok"`
	Output string `json:"output,omitempty"`
	Error  string `json:"error,omitempty"`
}

func main() {
	socket := os.Getenv("MATRESHKA_AGENT_SOCKET")
	if socket == "" {
		socket = defaultSocket
	}
	if err := os.MkdirAll(filepath.Dir(socket), 0750); err != nil {
		log.Fatal(err)
	}
	_ = os.Remove(socket)
	listener, err := net.Listen("unix", socket)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.Chmod(socket, 0660); err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	log.Printf("matreshka-agent listening on %s", socket)
	for {
		connection, err := listener.Accept()
		if err != nil {
			log.Printf("accept: %v", err)
			continue
		}
		go handle(connection)
	}
}

func handle(connection net.Conn) {
	defer connection.Close()
	if unix, ok := connection.(*net.UnixConn); ok {
		_ = unix.SetReadBuffer(64 * 1024)
	}
	reader := io.LimitReader(connection, 64*1024)
	line, err := bufio.NewReader(reader).ReadBytes('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		write(connection, response{OK: false, Error: "invalid request"})
		return
	}
	var request policy.Request
	if err := json.Unmarshal(line, &request); err != nil {
		write(connection, response{OK: false, Error: "invalid JSON"})
		return
	}
	if err := policy.Validate(request); err != nil {
		write(connection, response{OK: false, Error: err.Error()})
		return
	}
	output, err := execute(request)
	if err != nil {
		write(connection, response{OK: false, Error: err.Error(), Output: output})
		return
	}
	write(connection, response{OK: true, Output: output})
}

func execute(request policy.Request) (string, error) {
	switch request.Action {
	case "service.restart":
		return run("systemctl", "restart", request.Payload["service"].(string))
	case "service.start":
		return run("systemctl", "start", request.Payload["service"].(string))
	case "service.stop":
		return run("systemctl", "stop", request.Payload["service"].(string))
	case "nginx.reload":
		if output, err := run("nginx", "-t"); err != nil {
			return output, err
		}
		return run("systemctl", "reload", "nginx")
	case "setup.finalize":
		return run(
			"systemd-run", "--wait", "--collect", "--pipe", "--quiet",
			"/opt/matreshka/current/infra/scripts/finalize-domain",
			request.Payload["domain"].(string),
			request.Payload["publicIp"].(string),
		)
	case "engine.update":
		return run(
			"/opt/matreshka/current/infra/scripts/update-engine",
			request.Payload["engine"].(string),
			request.Payload["version"].(string),
			request.Payload["checksum"].(string),
		)
	case "update.apply":
		return run(
			"/opt/matreshka/current/infra/scripts/apply-update",
			request.Payload["bundle"].(string),
			request.Payload["signature"].(string),
		)
	case "backup.export":
		if passphrase, ok := request.Payload["passphrase"].(string); ok {
			return exportBackup(request.Payload["output"].(string), passphrase)
		}
		return run("/opt/matreshka/current/infra/scripts/export-backup-plain", request.Payload["output"].(string))
	case "config.apply":
		return run(
			"/opt/matreshka/current/infra/scripts/apply-config",
			request.Payload["source"].(string),
			request.Payload["target"].(string),
			request.Payload["engine"].(string),
		)
	case "xray.user.add":
		installed, err := install(request.Payload["rendered"].(string), "/etc/matreshka/engines/xray.json")
		if err != nil {
			return installed, err
		}
		output, err := run("/opt/matreshka/engines/xray/current/xray", "api", "adu", "--server=127.0.0.1:10085", request.Payload["source"].(string))
		if err == nil {
			return installed + "; " + output, nil
		}
		restarted, restartErr := run("systemctl", "restart", "xray")
		return installed + "; API unavailable, loaded recovery config; " + restarted, restartErr
	case "xray.user.revoke":
		installed, err := install(request.Payload["rendered"].(string), "/etc/matreshka/engines/xray.json")
		if err != nil {
			return installed, err
		}
		output, err := run("/opt/matreshka/engines/xray/current/xray", "api", "rmu", "--server=127.0.0.1:10085", "-tag=vless-xhttp", request.Payload["email"].(string))
		if err == nil {
			return installed + "; " + output, nil
		}
		restarted, restartErr := run("systemctl", "restart", "xray")
		return installed + "; API unavailable, loaded recovery config; " + restarted, restartErr
	default:
		return "", errors.New("unsupported action")
	}
}

func exportBackup(output, passphrase string) (string, error) {
	plain := output + ".plain"
	defer os.Remove(plain)
	if result, err := run("/opt/matreshka/current/infra/scripts/export-backup-plain", plain); err != nil {
		return result, err
	}
	input, err := os.Open(plain)
	if err != nil {
		return "", err
	}
	defer input.Close()
	temporary := output + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	cleanup := func() { _ = file.Close(); _ = os.Remove(temporary) }
	recipient, err := age.NewScryptRecipient(passphrase)
	if err != nil {
		cleanup()
		return "", err
	}
	recipient.SetWorkFactor(18)
	writer, err := age.Encrypt(file, recipient)
	if err != nil {
		cleanup()
		return "", err
	}
	if _, err = io.Copy(writer, input); err != nil {
		cleanup()
		return "", err
	}
	if err = writer.Close(); err != nil {
		cleanup()
		return "", err
	}
	if err = file.Close(); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	group, err := user.LookupGroup("matreshka")
	if err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	gid, err := strconv.Atoi(group.Gid)
	if err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	if err = os.Chown(temporary, -1, gid); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	if err = os.Chmod(temporary, 0640); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	if err = os.Rename(temporary, output); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	return output, nil
}

func install(source, target string) (string, error) {
	info, err := os.Lstat(source)
	if err != nil {
		return "", fmt.Errorf("could not inspect rendered config: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", errors.New("rendered config must be a regular file")
	}
	input, err := os.Open(source)
	if err != nil {
		return "", fmt.Errorf("could not open rendered config: %w", err)
	}
	defer input.Close()
	temporary := target + ".tmp"
	output, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, fs.FileMode(0640))
	if err != nil {
		return "", fmt.Errorf("could not create rendered config: %w", err)
	}
	if _, err = io.Copy(output, input); err != nil {
		_ = output.Close()
		return "", fmt.Errorf("could not copy rendered config: %w", err)
	}
	if err = output.Close(); err != nil {
		return "", fmt.Errorf("could not close rendered config: %w", err)
	}
	group, err := user.LookupGroup("matreshka")
	if err != nil {
		return "", fmt.Errorf("could not resolve matreshka group: %w", err)
	}
	gid, err := strconv.Atoi(group.Gid)
	if err != nil {
		return "", fmt.Errorf("could not parse matreshka group: %w", err)
	}
	if err = os.Chown(temporary, 0, gid); err != nil {
		return "", fmt.Errorf("could not set config ownership: %w", err)
	}
	if err = os.Rename(temporary, target); err != nil {
		return "", fmt.Errorf("could not install rendered config: %w", err)
	}
	return "recovery config installed", nil
}

func run(name string, args ...string) (string, error) {
	command := exec.Command(name, args...)
	command.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C.UTF-8"}
	output, err := command.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("operation failed: %w", err)
	}
	return string(output), nil
}

func write(writer io.Writer, value response) {
	_ = json.NewEncoder(writer).Encode(value)
}
