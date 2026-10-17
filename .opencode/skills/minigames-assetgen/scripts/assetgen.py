#!/usr/bin/env python3
"""Local MiniGames AssetGen helper: request queue, GPT Image API, alpha QA, fallbacks, spritesheets.

Only technical QA is automatic; style/geometry/Phaser approval requires independent review.
Paid requests are never made unless --allow-paid is supplied with an API key.
"""
from __future__ import annotations
import argparse
import base64
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

SIDES = ("top", "right", "bottom", "left")
KINDS = {
    "pipe-straight": ("top", "bottom"),
    "pipe-elbow": ("top", "right"),
    "pipe-t": ("top", "right", "left"),
    "pipe-cross": SIDES,
    "pipe-cap": ("top",),
    "valve-basic": ("top", "bottom"),
    "source-basic": ("right",),
    "receiver-basic": ("left",),
}


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def dump(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def safe_id(value):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", str(value)):
        raise ValueError("Unsafe asset id. Use [a-z0-9_-] up to 64 chars")
    return str(value)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def caps(image):
    return {"width": image.width, "height": image.height, "mode": image.mode}


def transparent_check(path: Path, padding=12, ports=None, preview=None):
    ports = ports or {}
    im = Image.open(path)
    im.load()
    flags = []
    if im.format != "PNG":
        flags.append("NOT_PNG")
    if im.mode != "RGBA":
        flags.append("NO_RGBA_ALPHA")
    im = im.convert("RGBA")
    alpha = im.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox:
        flags.append("EMPTY_SPRITE")
    if alpha.getextrema()[0] == 255:
        flags.append("OPAQUE_BACKGROUND")
    w, h = im.size
    # Corner transparency is necessary for a normal isolated tile, but not sufficient.
    c = min(max(2, padding), max(2, min(w, h) // 6))
    corners = [(0, 0, c, c), (w-c, 0, w, c), (0, h-c, c, h), (w-c, h-c, w, h)]
    corner_nonzero = sum(sum(1 for a in alpha.crop(t).get_flattened_data() if a > 16) for t in corners)
    if corner_nonzero > max(8, c*c*4*0.04):
        flags.append("NONTRANSPARENT_CORNERS")
    if bbox:
        left, top, right, bottom = bbox
        # Pipe output at an active port is expected to reach that tile's edge.
        if not ports.get("left") and left < padding:
            flags.append("CROPPED_OR_UNSAFE_LEFT")
        if not ports.get("top") and top < padding:
            flags.append("CROPPED_OR_UNSAFE_TOP")
        if not ports.get("right") and w-right < padding:
            flags.append("CROPPED_OR_UNSAFE_RIGHT")
        if not ports.get("bottom") and h-bottom < padding:
            flags.append("CROPPED_OR_UNSAFE_BOTTOM")
    if preview:
        p = Path(preview)
        p.mkdir(parents=True, exist_ok=True)
        for name, color in (("light", (247,247,247,255)), ("dark", (32,35,43,255))):
            canvas = Image.new("RGBA", im.size, color)
            canvas.alpha_composite(im)
            canvas.convert("RGB").save(p / f"{path.stem}_{name}.png")
        canvas = Image.new("RGBA", im.size, (250,250,250,255))
        d = ImageDraw.Draw(canvas)
        step = max(8, int(min(w,h)/16))
        for x in range(0,w,step):
            for y in range(0,h,step):
                if (x//step+y//step)%2:
                    d.rectangle((x,y,min(w,x+step),min(h,y+step)), fill=(205,205,205,255))
        canvas.alpha_composite(im)
        canvas.convert("RGB").save(p / f"{path.stem}_checker.png")
    return {
        "file": str(path), "status": "VALID_TECH" if not flags else "REJECTED_TECH",
        "flags": list(dict.fromkeys(flags)), "bbox": bbox, "dimensions": caps(im),
        "sha256": sha(path), "note": "TECH ONLY; style, ports and Phaser integration NOT approved"
    }


def make_placeholder(kind: str, size: int, output: Path):
    if not (64 <= size <= 2048):
        raise ValueError("size must be in 64..2048")
    aliases = {"pipe_straight":"pipe-straight", "pipe_elbow":"pipe-elbow", "pipe_t":"pipe-t", "pipe_cross":"pipe-cross", "pipe_cap":"pipe-cap", "valve":"valve-basic", "source":"source-basic", "receiver":"receiver-basic"}
    kind = aliases.get(kind, kind)
    arms = KINDS.get(kind)
    if arms is None:
        raise ValueError(f"Unknown kind {kind}. Choose one of {list(KINDS)}")
    im = Image.new("RGBA", (size, size), (0,0,0,0))
    d = ImageDraw.Draw(im)
    cx = cy = size // 2
    thick = int(size * .30)
    hole = int(size * .18)
    points = {"top":(cx,0), "bottom":(cx,size-1), "left":(0,cy), "right":(size-1,cy)}
    center = (cx,cy)
    for side in arms:
        d.line([center, points[side]], fill=(62,78,97,255), width=thick)
    d.ellipse((cx-thick//2, cy-thick//2, cx+thick//2, cy+thick//2), fill=(62,78,97,255))
    for side in arms:
        d.line([center, points[side]], fill=(88,174,213,220), width=hole)
    d.ellipse((cx-hole//2, cy-hole//2, cx+hole//2, cy+hole//2), fill=(88,174,213,220))
    if kind == "valve-basic":
        r = size * .14
        d.ellipse((cx-r,cy-r,cx+r,cy+r), fill=(243,183,66,255), outline=(30,39,47,255), width=max(2,size//64))
        d.line((cx-r/2,cy,cx+r/2,cy), fill=(30,39,47,255), width=max(2,size//32))
    if kind.startswith(("source", "receiver")):
        r = size * .23
        d.ellipse((cx-r,cy-r,cx+r,cy+r), fill=(23,125,203,255) if kind.startswith("source") else (68,181,112,255))
        d.text((cx,cy), "S" if kind.startswith("source") else "R", fill="white", anchor="mm")
    # Not for final releases: a visible tiny mark makes accidental shipping obvious.
    d.rectangle((int(size*.33),int(size*.72),int(size*.67),int(size*.81)), fill=(202,68,62,255))
    d.text((cx, int(size*.765)), "TMP", fill="white", anchor="mm")
    output.parent.mkdir(parents=True, exist_ok=True)
    im.save(output, format="PNG")
    dump(output.with_suffix(".meta.json"), {"kind":kind,"status":"PLACEHOLDER","is_placeholder":True,
      "logical_cell_px":size,"port_mask":{s:s in arms for s in SIDES},"pivot":{"x":.5,"y":.5},
      "water_mask_required":True,"created_at":stamp(),"note":"Primitive development-only image; never APPROVED"})
    return output


def normalized(file: Path, out: Path, size: int, padding: int):
    if not 0 <= padding <= size//4:
        raise ValueError("Invalid padding")
    im = Image.open(file).convert("RGBA")
    bbox = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox:
        raise ValueError("Source image is fully transparent")
    crop = im.crop(bbox)
    # For connector-bearing tiles, prefer exact geometry plus insets per port rather than generic normalization.
    crop.thumbnail((size-2*padding,size-2*padding), Image.Resampling.LANCZOS)
    output = Image.new("RGBA", (size,size), (0,0,0,0))
    output.alpha_composite(crop, ((size-crop.width)//2,(size-crop.height)//2))
    out.parent.mkdir(parents=True, exist_ok=True)
    output.save(out)
    return out


def slice_sheet(file: Path, rows: int, cols: int, outdir: Path):
    im = Image.open(file).convert("RGBA")
    if not rows > 0 or not cols > 0 or im.width % cols or im.height % rows:
        raise ValueError("Image dimensions must be divisible by rows and cols")
    w, h = im.width//cols, im.height//rows
    outdir.mkdir(parents=True, exist_ok=True)
    result=[]
    for i in range(rows):
        for j in range(cols):
            p=outdir/f"{file.stem}_{i:02d}_{j:02d}.png"
            im.crop((j*w,i*h,(j+1)*w,(i+1)*h)).save(p)
            result.append(str(p))
    dump(outdir/f"{file.stem}_slicing.json", {"origin":str(file),"rows":rows,"cols":cols,
        "frame_width":w,"frame_height":h,"frames":result,"warning":"Check each frame visually for bleed/cropping"})
    return result


def atlas(files: list[Path], out: Path, meta: Path, max_width: int):
    if not files:
        raise ValueError("No images")
    ims=[(f, Image.open(f).convert("RGBA")) for f in files]
    pad=2
    width=max(max_width, max(im.width+pad*2 for _,im in ims))
    coords=[]
    x=y=pad
    row_h=0
    for f,im in ims:
        if x+im.width+pad>width:
            y+=row_h+pad
            x=pad; row_h=0
        coords.append((x,y))
        x+=im.width+pad
        row_h=max(row_h, im.height)
    height=y+row_h+pad
    output=Image.new("RGBA",(width,height),(0,0,0,0))
    frames={}
    for (file,img),(px,py) in zip(ims,coords):
        if file.stem in frames:
            raise ValueError(f"Duplicate frame name: {file.stem}")
        output.alpha_composite(img,(px,py))
        frames[file.stem]={"frame":{"x":px,"y":py,"w":img.width,"h":img.height},
                           "rotated":False,"trimmed":False,"spriteSourceSize":{"x":0,"y":0,"w":img.width,"h":img.height},
                           "sourceSize":{"w":img.width,"h":img.height}}
    out.parent.mkdir(parents=True, exist_ok=True)
    output.save(out)
    dump(meta,{"frames":frames,"meta":{"image":out.name,"format":"RGBA8888","size":{"w":width,"h":height},
        "scale":"1","app":"MiniGames AssetGen"}, "assetgen_status":"PROCESSING_NOT_APPROVED"})
    return len(frames)


def job_path(workspace, job):
    return Path(workspace)/'jobs'/(safe_id(job)+'.json')


def ensure_placeholder(workspace, request):
    p=Path(workspace)/"placeholders"/(safe_id(request['asset_id'])+'.png')
    if not p.exists():
        kind=request.get('kind','pipe-straight')
        if kind not in KINDS:
            kind='pipe-straight'
        make_placeholder(kind, int(request.get('logical_cell_px',256)), p)
    return p


def submit(workspace, file):
    request=read(Path(file))
    job=safe_id(request['asset_id'])
    for key in ('game_id','kind','style_id','prompt','logical_cell_px'):
        if key not in request:
            raise ValueError(f"Request missing {key}")
    path=job_path(workspace,job)
    if path.exists():
        raise ValueError(f"Request already exists: {path}")
    placeholder=ensure_placeholder(workspace,request)
    record={"id":job, "request":request,"status":"REQUESTED","attempts":0,"max_attempts":3,
           "placeholder":str(placeholder), "created_at":stamp(),"history":[],"approved":False}
    dump(path,record)
    return record


def vision_review(client, path, request):
    """Independent vision QA. Probabilistic: PASS does not replace Phaser integration review."""
    refs = request.get('style_reference_files', [])
    if not refs:
        return {"passed": False, "reason": "No approved style references; manual style review needed", "reviewer": "not_run"}
    content = [{"type":"input_text", "text": (
        "You are an independent game-sprite reviewer. Compare the first image (candidate) "
        "with the remaining approved style references. Is it a single isolated "
        f"{request['kind']} game sprite, with intended ports {request.get('port_mask', {})}, "
        "consistent stylized 2.5D angle, lighting, glass/metal materials, and detail? "
        "Reject if wrong pipe geometry, extra objects, lettering, opaque background, "
        "poor similarity to approved refs, obvious cropping or broken junctions. "
        "Return ONLY JSON: {\"passed\":true/false,\"reason\":\"...\"}. "
        "Be strict and explain reasons." )}]
    files=[Path(path)] + [Path(p) for p in refs[:5]]
    for f in files:
        if not f.is_file():
            return {"passed":False,"reason":f"Missing reference: {f}","reviewer":"not_run"}
        b64=base64.b64encode(f.read_bytes()).decode()
        content.append({"type":"input_image","image_url":f"data:image/png;base64,{b64}","detail":"high"})
    response=client.responses.create(model=os.getenv('ASSETGEN_REVIEW_MODEL','gpt-4.1-mini'),
      input=[{"role":"user","content":content}])
    message=response.output_text.strip()
    match=re.search(r"\{.*\}", message, re.S)
    if not match:
        raise ValueError('Vision reviewer returned non-JSON')
    value=json.loads(match.group(0))
    return {"passed":value.get('passed') is True,"reason":str(value.get('reason',''))[:1500],
            "reviewer":os.getenv('ASSETGEN_REVIEW_MODEL','gpt-4.1-mini')}


def process(workspace, job, allow_paid=False, model=None):
    path=job_path(workspace,job)
    r=read(path)
    if r.get('approved') or r.get('status') in ('READY_FOR_INTEGRATION','MANUAL_REVIEW_REQUIRED','APPROVED','BLOCKED_CONFIG'):
        return r
    if r.get('attempts',0)>=r.get('max_attempts',3):
        r['status']='MANUAL_REVIEW_REQUIRED';dump(path,r);return r
    now=dt.datetime.now(dt.timezone.utc)
    if r.get('next_retry_at'):
        t=dt.datetime.fromisoformat(r['next_retry_at'])
        if t>now:
            return r
    if not os.environ.get("OPENAI_API_KEY") or not allow_paid:
        r['status']='WAITING_FOR_PROVIDER'
        r['blocker']='Require OPENAI_API_KEY and explicit --allow-paid for API charges'
        dump(path,r);return r
    try:
        from openai import OpenAI
        client=OpenAI(timeout=110)
        req=r['request']
        prompt=req['prompt']+ ("\nPrevious rejected attempt: " + str(r.get('blocker','')) if r.get('attempts',0)>0 else "") +"\nOnly a single isolated game sprite on transparent background, no backdrop or checkerboard, no text. Style ID: "+req['style_id']
        # No automatic claim of style reference binding; ref images require a separate verified edit adapter.
        refs=[Path(p) for p in req.get('style_reference_files',[])][:5]
        if refs and all(p.is_file() for p in refs):
            img=client.images.edit(model=model or os.getenv('ASSETGEN_IMAGE_MODEL','gpt-image-2.5-flare'),
                image=refs, prompt=prompt + '\nUse reference image(s) for artistic STYLE ONLY, not for the object shape.',
                size='1024x1024', quality='medium', background='transparent', output_format='png', n=1)
        else:
            img=client.images.generate(model=model or os.getenv('ASSETGEN_IMAGE_MODEL','gpt-image-2.5-flare'),
                prompt=prompt, size='1024x1024', quality='medium', background='transparent', output_format='png', n=1)
        binary=base64.b64decode(img.data[0].b64_json)
        r['attempts']+=1
        out=Path(workspace)/'raw'/f"{job}_try{r['attempts']}.png"
        out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(binary)
        report=transparent_check(out, padding=int(req.get('acceptance',{}).get('safe_padding_px',12)),ports=req.get('port_mask',{}),
                                 preview=Path(workspace)/'previews')
        report_path=Path(workspace)/'reports'/f"{job}_try{r['attempts']}.json";dump(report_path,report)
        r['raw_file']=str(out);r['tech_report']=str(report_path)
        if report['status']=='VALID_TECH':
            vreport=vision_review(client,out,req)
            vpath=Path(workspace)/'reports'/f"{job}_try{r['attempts']}_vision.json"
            dump(vpath,vreport)
            r['vision_report']=str(vpath)
            if vreport.get('passed'):
                r['status']='READY_FOR_INTEGRATION'
                r['blocker']='Vision QA passed (probabilistic); verify channel mask, port overlay and Phaser screenshots before APPROVED'
            elif vreport.get('reviewer')=='not_run':
                r['status']='MANUAL_REVIEW_REQUIRED'
                r['blocker']=vreport['reason']
            else:
                r['status']='RETRY_REQUIRED' if r['attempts']<r['max_attempts'] else 'MANUAL_REVIEW_REQUIRED'
                r['blocker']='Vision QA rejected: '+vreport['reason']
        else:
            r['status']='RETRY_REQUIRED' if r['attempts']<r['max_attempts'] else 'MANUAL_REVIEW_REQUIRED'
            r['blocker']='; '.join(report['flags'])
        r.pop('next_retry_at',None)
    except Exception as exc:
        # Distinguish rate limits from absent budget and auth; never print credentials.
        code=getattr(exc,'status_code',None)
        payload=str(exc).lower()
        if code==429 and ('insufficient_quota' not in payload and 'billing' not in payload):
            headers=getattr(getattr(exc,'response',None),'headers',{}) or {}
            try: seconds=max(60,min(86400,int(headers.get('retry-after',900))))
            except (ValueError,TypeError): seconds=900
            r['status']='WAITING_FOR_LIMITS'
            r['next_retry_at']=(now+dt.timedelta(seconds=seconds)).isoformat()
            r['blocker']=f'HTTP 429. Try again no earlier than {r["next_retry_at"]}'
        elif code in (401,403) or 'insufficient_quota' in payload or 'billing' in payload:
            r['status']='WAITING_FOR_PROVIDER';r['blocker']=f'Provider access/billing issue: HTTP {code}'
        else:
            r['status']='WAITING_FOR_PROVIDER'
            r['blocker']=f'Provider request failed; classify/check model support: {type(exc).__name__}; HTTP {code}'
        r['history'].append({"timestamp":stamp(),"event":r['status'],"reason":r['blocker']})
    dump(path,r)
    return r


# ---------- §17 canonical reconcile ----------

# TZ v1.2 states. `status` (legacy UPPER) is kept for compatibility; `state`
# (lowercase) is the canonical value owned by registry.json.
STATE_TO_STATUS = {
    "requested": "REQUESTED",
    "generating": "GENERATING",
    "validating": "VALIDATING",
    "approved": "APPROVED",
    "rejected": "REJECTED",
    "retry": "RETRY",
    "waiting_for_limits": "WAITING_FOR_LIMITS",
    "waiting_for_provider": "WAITING_FOR_PROVIDER",
    "manual_review_required": "MANUAL_REVIEW_REQUIRED",
    "placeholder": "PLACEHOLDER",
}
LEGACY_STATE = {
    "approved": "approved",
    "placeholder": "placeholder",
    "ready_for_integration": "approved",
    "valid_tech": "validating",
    "rejected": "rejected",
    "rejected_tech": "rejected",
    "waiting_for_provider": "waiting_for_provider",
    "waiting_for_limits": "waiting_for_limits",
    "manual_review_required": "manual_review_required",
}


def _canonical_state(value):
    return LEGACY_STATE.get(str(value or "").lower(), "requested")


def _prompt_hash(request):
    prompt = (request or {}).get("prompt")
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest() if isinstance(prompt, str) else None


def _rotate_mask(mask):
    # Rotating a tile 90deg clockwise: top<-left, right<-top, bottom<-right, left<-bottom.
    return {
        "top": bool(mask.get("left")),
        "right": bool(mask.get("top")),
        "bottom": bool(mask.get("right")),
        "left": bool(mask.get("bottom")),
    }


def reconcile(workspace="assetgen-work", assets_root="assets/plumber", padding=12):
    """Single canonical reconciliation.

    registry.json owns asset states; budget.json owns the budget ledger. Legacy
    job files and the registry budget snapshot are migrated to those sources,
    APPROVED files are re-validated (missing/opaque => downgraded + placeholder),
    and per-PNG provenance is (re)computed. Idempotent: a second run changes
    nothing and preserves previously approved tiles.
    """
    ws = Path(workspace)
    reg_path = ws / "registry.json"
    budget_path = ws / "budget.json"
    jobs_dir = ws / "jobs"
    registry = read(reg_path) if reg_path.exists() else {"style_id": None, "provider": "unknown", "assets": {}}
    registry.setdefault("assets", {})
    registry.setdefault("provider", "unknown")
    budget = read(budget_path) if budget_path.exists() else {}
    jobs = {read(f)["id"]: read(f) for f in sorted(jobs_dir.glob("*.json"))} if jobs_dir.exists() else {}

    # Integration geometry (tiles.json) is the authoritative port map; job
    # requests are migrated to agree with it (the divergence TZ v1.2 §17 flags).
    geo = {}
    tiles_json = Path(assets_root) / "tiles.json"
    if tiles_json.exists():
        for gid, g in (read(tiles_json).get("tiles") or {}).items():
            if g.get("ports"):
                geo[gid] = g["ports"]
    # Only these flags mean the file itself is unusable; edge-bleed/padding flags
    # are recorded as warnings because seamless tiles intentionally reach edges.
    CRITICAL = {"NOT_PNG", "NO_RGBA_ALPHA", "EMPTY_SPRITE", "OPAQUE_BACKGROUND"}

    # Canonical budget counts come from the ledger; job/registry snapshots follow it.
    canon_budget = {
        "low_used": int(budget.get("low_used", 0)),
        "low_limit": int(budget.get("low_limit", 0)),
        "medium_used": int(budget.get("medium_used", 0)),
        "medium_limit": int(budget.get("medium_limit", 0)),
    }

    changed = 0
    report = {"approved": 0, "rejected": [], "placeholders": [], "pending": [], "changed": 0}
    provenance = {}
    approved_ids = []

    for aid in sorted(registry["assets"].keys()):
        entry = registry["assets"][aid]
        job = jobs.get(aid)
        request = (job or {}).get("request") or {}
        state = _canonical_state(entry.get("status", entry.get("state")))
        fpath = Path(entry.get("file") or (assets_root / "tiles" / f"{aid}.png"))
        tech = None

        ports = geo.get(aid) or request.get("port_mask") or {}

        if state == "approved":
            if not fpath.exists():
                state = "placeholder"
                entry["reason"] = "approved file missing on disk"
            else:
                tech = transparent_check(fpath, padding, ports=ports)
                critical = [f for f in tech["flags"] if f in CRITICAL]
                if critical:
                    state = "rejected"
                    entry["reason"] = ",".join(critical)
                    entry["retryable"] = True
                else:
                    entry.pop("reason", None)
                    entry["warnings"] = [f for f in tech["flags"] if f not in CRITICAL]
                    if request and ports and request.get("port_mask") != ports:
                        request["port_mask"] = ports
                        entry["ports_migrated"] = True
                    approved_ids.append(aid)

        if state == "approved":
            report["approved"] += 1
            alpha = Image.open(fpath).convert("RGBA").getchannel("A")
            has_transparency = alpha.getextrema()[0] < 255
            mask = ports
            rotations = [mask]
            for _ in range(3):
                rotations.append(_rotate_mask(rotations[-1]))
            provenance[aid] = {
                "state": "approved",
                "provider": registry.get("provider"),
                "origin": (job or {}).get("origin") or "gpt-image-subscription",
                "source_file": entry.get("source"),
                "file": str(fpath),
                "sha256": tech["sha256"],
                "dimensions": tech["dimensions"],
                "has_transparency": has_transparency,
                "bbox": tech["bbox"],
                "style_id": (job or {}).get("request", {}).get("style_id") or registry.get("style_id"),
                "prompt_hash": _prompt_hash(request),
                "version": (job or {}).get("version", 1),
                "license": "provider-generated (OpenAI image); project-owned usage",
                "ports": mask,
                "ports_after_rotation": rotations,
                "previews": entry.get("previews"),
                "phaser_snapshot": (registry.get("integration") or {}).get("phaser_screenshots", [None])[0],
                "tech": tech["status"],
            }
        elif state == "placeholder":
            ph = ws / "placeholders" / f"{aid}.png"
            if not ph.exists():
                kind = request.get("kind") or ("pipe-straight" if "pipe" in aid else aid.replace("_", "-"))
                if kind not in KINDS:
                    kind = "pipe-straight"
                make_placeholder(kind, request.get("logical_cell_px", 256), ph)
            entry.setdefault("placeholder", str(ph))
            report["placeholders"].append(aid)
        elif state in ("waiting_for_provider", "waiting_for_limits"):
            report["pending"].append(aid)
            ph = ws / "placeholders" / f"{aid}.png"
            if not ph.exists():
                kind = request.get("kind") or "pipe-straight"
                if kind not in KINDS:
                    kind = "pipe-straight"
                make_placeholder(kind, request.get("logical_cell_px", 256), ph)
            entry.setdefault("placeholder", str(ph))
        if state == "rejected":
            report["rejected"].append({"id": aid, "reason": entry.get("reason")})
            ph = ws / "placeholders" / f"{aid}.png"
            if not ph.exists():
                make_placeholder("pipe-straight", request.get("logical_cell_px", 256), ph)
            entry.setdefault("placeholder", str(ph))

        entry["state"] = state
        entry["status"] = STATE_TO_STATUS[state]
        if job is not None:
            prev_state = _canonical_state(job.get("status"))
            job["state"] = state
            job["status"] = STATE_TO_STATUS[state]
            job["approved"] = state == "approved"
            if prev_state != state:
                job.setdefault("history", []).append({"timestamp": stamp(), "event": "reconcile", "from": prev_state, "to": state, "reason": entry.get("reason")})
                changed += 1
            if state == "approved" and job.get("blocker"):
                job.pop("blocker", None)

    # Budget snapshot adopts the canonical ledger.
    if registry.get("budget") != canon_budget:
        changed += 1
    registry["budget"] = canon_budget
    registry.setdefault("provenance", {})
    registry["provenance"].update(provenance)
    registry["generated_at"] = stamp()
    registry["states"] = sorted(STATE_TO_STATUS.keys())

    # Atlas metadata must match the approved files actually shipped.
    integration = registry.get("integration") or {}
    atlas_json = integration.get("atlas_json")
    atlas_mismatch = []
    if atlas_json and Path(atlas_json).exists():
        frames = set((read(Path(atlas_json)).get("frames") or {}).keys())
        for aid in approved_ids:
            if Path(integration.get("atlas", "")).exists() and aid not in frames and aid.replace("_basic", "") not in frames:
                atlas_mismatch.append(aid)
        integration["frame_mismatch"] = atlas_mismatch
    registry["integration"] = integration

    # Every registry asset gets a queue job file so status/queue never diverge.
    for aid in sorted(registry["assets"].keys()):
        if aid in jobs:
            continue
        entry = registry["assets"][aid]
        request = {
            "game_id": "plumber",
            "asset_id": aid,
            "style_id": registry.get("style_id"),
            "kind": aid.replace("_", "-"),
            "logical_cell_px": 256,
            "port_mask": geo.get(aid, {}),
            "prompt": None,
        }
        job = {
            "id": aid,
            "request": request,
            "status": entry.get("status"),
            "state": entry.get("state"),
            "attempts": 1,
            "max_attempts": 3,
            "placeholder": entry.get("placeholder"),
            "created_at": stamp(),
            "history": [{"timestamp": stamp(), "event": "reconcile", "to": entry.get("state"), "reason": "synthesised from registry"}],
            "approved": entry.get("state") == "approved",
            "origin": "gpt-image-subscription",
            "source": entry.get("source"),
        }
        jobs[aid] = job
        changed += 1

    report["changed"] = changed
    report["budget"] = canon_budget
    dump(reg_path, registry)
    for aid, job in jobs.items():
        dump(jobs_dir / f"{aid}.json", job)
    return report


def main():
    pa=argparse.ArgumentParser(description=__doc__)
    sub=pa.add_subparsers(dest='cmd',required=True)
    v=sub.add_parser('validate');v.add_argument('--file',required=True);v.add_argument('--padding',type=int,default=12);v.add_argument('--preview-dir');v.add_argument('--ports-json', help='Path to request JSON containing port_mask')
    p=sub.add_parser('placeholder');p.add_argument('--kind',required=True);p.add_argument('--size',type=int,default=256);p.add_argument('--output',required=True)
    sl=sub.add_parser('slice');sl.add_argument('--file',required=True);sl.add_argument('--rows',type=int,required=True);sl.add_argument('--cols',type=int,required=True);sl.add_argument('--outdir',required=True)
    al=sub.add_parser('atlas');al.add_argument('--inputs',nargs='+',required=True);al.add_argument('--output',required=True);al.add_argument('--meta',required=True);al.add_argument('--width',type=int,default=1024)
    no=sub.add_parser('normalize');no.add_argument('--file',required=True);no.add_argument('--output',required=True);no.add_argument('--size',type=int,default=256);no.add_argument('--padding',type=int,default=12)
    su=sub.add_parser('submit');su.add_argument('--request',required=True);su.add_argument('--workspace',default='assetgen-work')
    pr=sub.add_parser('process');pr.add_argument('--asset',required=True);pr.add_argument('--workspace',default='assetgen-work');pr.add_argument('--allow-paid',action='store_true');pr.add_argument('--model')
    st=sub.add_parser('status');st.add_argument('--workspace',default='assetgen-work');st.add_argument('--asset')
    rc=sub.add_parser('reconcile');rc.add_argument('--workspace',default='assetgen-work');rc.add_argument('--assets-root',default='assets/plumber')
    a=pa.parse_args()
    if a.cmd=='validate':
        result=transparent_check(Path(a.file),a.padding,ports=read(Path(a.ports_json)).get('port_mask',{}) if a.ports_json else None,preview=a.preview_dir)
    elif a.cmd=='placeholder':
        result={"file":str(make_placeholder(a.kind,a.size,Path(a.output))),"status":"PLACEHOLDER"}
    elif a.cmd=='slice':
        result={"frames":slice_sheet(Path(a.file),a.rows,a.cols,Path(a.outdir))}
    elif a.cmd=='atlas':
        result={"frames":atlas([Path(f) for f in a.inputs],Path(a.output),Path(a.meta),a.width),"status":"PROCESSING_NOT_APPROVED"}
    elif a.cmd=='normalize':
        result={"file":str(normalized(Path(a.file),Path(a.output),a.size,a.padding)),"status":"PROCESSING_NOT_APPROVED"}
    elif a.cmd=='submit':
        result=submit(a.workspace,a.request)
    elif a.cmd=='process':
        result=process(a.workspace,a.asset,a.allow_paid,a.model)
    elif a.cmd=='reconcile':
        result=reconcile(a.workspace,a.assets_root)
    else:
        folder=Path(a.workspace)/'jobs'
        jobs=[read(f) for f in sorted(folder.glob('*.json'))] if folder.exists() else []
        result= next((i for i in jobs if i['id']==a.asset), None) if a.asset else [{"id":r['id'],"status":r['status'],"attempts":r['attempts'],"placeholder":r['placeholder']} for r in jobs]
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if a.cmd=='validate' and result['status']!='VALID_TECH':
        sys.exit(2)

if __name__=='__main__':
    main()
