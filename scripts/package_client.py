# -*- coding: utf-8 -*-
"""
Package a standalone CLIENT deliverable from the consultant master.

For a given company id it builds dist/<id>/ containing only that client's
data and a client-mode app.json (single locked company, no company switcher).
Hand the folder to the client to run on their own machine or host on Pages.

Usage:
    python scripts/package_client.py --id acme
    python scripts/package_client.py --all          # every active company
    python scripts/package_client.py --id acme --refresh   # regenerate snapshot first

Output: dist/<id>/  (index.html, assets/, config/, data/, start.bat, .nojekyll)
"""
import argparse
import io
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def log(m):
    sys.stdout.write(m + "\n"); sys.stdout.flush()


def rel(p):
    return os.path.join(ROOT, p)


def load_json(p):
    return json.load(io.open(rel(p), encoding="utf-8"))


def build_one(company, standard_version, refresh):
    cid = company["id"]
    name = company.get("name", cid)
    dist = rel(os.path.join("dist", cid))
    log("== 打包客戶交付版：%s (%s) ==" % (name, cid))

    if refresh:
        log("  重新產生快照 ...")
        subprocess.run([sys.executable, rel("scripts/snapshot.py"), "--id", cid], check=False)

    # clean output
    if os.path.isdir(dist):
        shutil.rmtree(dist)
    os.makedirs(os.path.join(dist, "config"))
    os.makedirs(os.path.join(dist, "data"))

    # 1) shared front-end (code is identical across clients)
    shutil.copy(rel("index.html"), dist)
    shutil.copytree(rel("assets"), os.path.join(dist, "assets"))
    shutil.copytree(rel("vendor"), os.path.join(dist, "vendor"))  # Chart.js, for offline use
    shutil.copy(rel(".nojekyll"), dist)

    # 2) standard layer + this client's override + snapshot
    shutil.copy(rel("config/standard-sources.json"), os.path.join(dist, "config"))
    ov_src = company.get("configFile", "config/company.%s.json" % cid)
    if os.path.exists(rel(ov_src)):
        shutil.copy(rel(ov_src), os.path.join(dist, "config", "company.%s.json" % cid))
    else:
        io.open(os.path.join(dist, "config", "company.%s.json" % cid), "w", encoding="utf-8").write(
            json.dumps({"id": cid, "name": name, "basedOnStandard": standard_version,
                        "sourcesAdd": [], "sourcesHide": [], "countermeasuresAdd": []},
                       ensure_ascii=False, indent=2))
    snap_src = company.get("snapshotFile", "data/snapshot.%s.json" % cid)
    if os.path.exists(rel(snap_src)):
        shutil.copy(rel(snap_src), os.path.join(dist, "data", "snapshot.%s.json" % cid))
    else:
        io.open(os.path.join(dist, "data", "snapshot.%s.json" % cid), "w", encoding="utf-8").write(
            json.dumps({"company": cid, "name": name, "years": {}}, ensure_ascii=False))

    # 3) client-mode app.json (single locked company, NO switcher)
    client_company = {
        "id": cid, "name": name,
        "years": company.get("years", {}),
        "configFile": "config/company.%s.json" % cid,
        "snapshotFile": "data/snapshot.%s.json" % cid
    }
    app = {
        "mode": "client",
        "consultantName": company.get("consultantName", "資安顧問"),
        "branding": {"title": name + " · 情資戰情看板",
                     "subtitle": "Threat Intelligence War-Room"},
        "company": client_company
    }
    io.open(os.path.join(dist, "config", "app.json"), "w", encoding="utf-8").write(
        json.dumps(app, ensure_ascii=False, indent=2))

    # 4) launcher + readme + optional write-back endpoint template for the client
    shutil.copy(rel("start.bat"), dist)
    if os.path.exists(rel("start.sh")):
        shutil.copy(rel("start.sh"), dist)
    if os.path.exists(rel("scripts/apps_script_endpoint.gs")):
        shutil.copy(rel("scripts/apps_script_endpoint.gs"), dist)
    io.open(os.path.join(dist, "README.txt"), "w", encoding="utf-8").write(
        "%s 情資戰情看板（客戶獨立版）\n"
        "=================================\n\n"
        "啟動方式：雙擊 start.bat，瀏覽器會開啟 http://localhost:8080\n"
        "（或執行 python -m http.server 8080 後開啟該網址）\n\n"
        "本版本鎖定貴公司資料，無公司切換功能。\n"
        "可在『來源維護』頁維護貴公司專屬的情資來源與因應對策。\n"
        "可在『情資維護』頁新增情資：填表後『複製/匯出』貼回 Google Sheet；\n"
        "若要直接寫入，請依 apps_script_endpoint.gs 的步驟部署端點後填入網址。\n"
        "如需更新標準來源，請向顧問索取新版 config/standard-sources.json。\n\n"
        "---------------------------------\n"
        "製作：Allan Lo 顧問\n"
        "Email：allanlo.plus@gmail.com\n"
        "網站：http://www.123hi.org\n"
        "(c) 2026 年 6 月 版權所有\n" % name)

    total = 0
    try:
        snap = json.load(io.open(os.path.join(dist, "data", "snapshot.%s.json" % cid), encoding="utf-8"))
        total = sum(len(v) for v in snap.get("years", {}).values())
    except Exception:
        pass
    log("  -> %s  （快照 %d 筆，已含 client app.json，無切換下拉）" % (os.path.relpath(dist, ROOT), total))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", help="company id to package")
    ap.add_argument("--all", action="store_true", help="package every active company")
    ap.add_argument("--refresh", action="store_true", help="regenerate snapshot before packaging")
    args = ap.parse_args()

    companies_cfg = load_json("config/companies.json")
    std_ver = load_json("config/standard-sources.json").get("version", "")
    companies = companies_cfg.get("companies", [])
    if args.id:
        companies = [c for c in companies if c["id"] == args.id]
    elif not args.all:
        log("請指定 --id <公司> 或 --all")
        return
    else:
        companies = [c for c in companies if c.get("active", True)]
    if not companies:
        log("找不到符合的公司"); return

    for c in companies:
        build_one(c, std_ver, args.refresh)
    log("\n完成。交付資料夾在 dist/ 下，整包交給客戶即可。")


if __name__ == "__main__":
    main()
