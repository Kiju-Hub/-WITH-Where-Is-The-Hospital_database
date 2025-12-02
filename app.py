from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
import csv
import os
import math
import requests
import xmltodict
from dotenv import load_dotenv
from datetime import datetime
from openai import OpenAI   # 최신 SDK

# ================================
# 초기 설정
# ================================
basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

app = Flask(__name__)
CORS(app)

CSV_FILE = os.path.join(os.path.dirname(__file__), "data", "hospitals.csv")

# .env 파일에서 API 키 로드
PUBLIC_KEY = os.getenv("PUBLIC_DATA_API_KEY")      # 응급실용 키
KAKAO_KEY = os.getenv("KAKAO_MAP_API_KEY")         # 카카오맵 키
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")       # OpenAI 키
PHARMACY_KEY = os.getenv("PHARMACY_API_KEY")       # [수정됨] 약국용 키 (환경변수 사용)

client = OpenAI(api_key=OPENAI_API_KEY)


# ================================
# 공통 함수
# ================================
def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def safe_float(val):
    """공공데이터 null/빈문자/공백 방지"""
    try:
        if val is None:
            return None
        v = str(val).strip()
        if v == "":
            return None
        return float(v)
    except:
        return None


# 약국 영업시간 판별
def is_pharmacy_open(item):
    now = datetime.now()
    weekdays = ["1", "2", "3", "4", "5", "6", "7"]
    day_code = weekdays[now.weekday()]

    start_key = f"dutyTime{day_code}s"
    end_key = f"dutyTime{day_code}c"

    if start_key not in item or end_key not in item:
        return "정보없음"

    try:
        current = int(now.strftime("%H%M"))
        start = int(item[start_key])
        end = int(item[end_key])

        if start <= current <= end:
            return "영업중"
        return "영업종료"
    except:
        return "확인불가"


# ================================
# 메인 페이지
# ================================
@app.route("/")
def home():
    return render_template("index.html", kakao_key=KAKAO_KEY)


# ================================
# [API 1] CSV 기반 병원 검색
# ================================
@app.route("/api/hospitals")
def get_hospitals():
    user_lat = request.args.get("lat", type=float)
    user_lon = request.args.get("lon", type=float)
    keyword = request.args.get("keyword", default="", type=str)
    radius_km = request.args.get("radius", default=3.0, type=float) # 반경 받기

    if user_lat is None or user_lon is None:
        return jsonify({"error": "위치 정보가 필요합니다."}), 400

    result = []

    try:
        with open(CSV_FILE, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    if not row.get("좌표(Y)") or not row.get("좌표(X)"):
                        continue

                    name = row["요양기관명"]
                    if keyword and keyword not in name:
                        continue

                    h_lat = float(row["좌표(Y)"])
                    h_lon = float(row["좌표(X)"])
                    dist = calculate_distance(user_lat, user_lon, h_lat, h_lon)

                    # [필터링] 선택한 반경 이내만 추가
                    if dist <= radius_km:
                        result.append({
                            "name": name,
                            "address": row["주소"],
                            "phone": row["전화번호"],
                            "lat": h_lat,
                            "lng": h_lon,
                            "distance": round(dist, 2)
                        })
                except ValueError:
                    continue
    except FileNotFoundError:
        return jsonify({"error": "CSV 파일이 없습니다."}), 500

    result.sort(key=lambda x: x["distance"])
    return jsonify(result)


# ================================
# [API 2] 실시간 응급실
# ================================
@app.route("/api/emergency")
def get_emergency():
    user_lat = request.args.get("lat", type=float)
    user_lon = request.args.get("lon", type=float)

    # 응급실 검색 (기존 유지)
    url = "http://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire"
    params = {
        "serviceKey": PUBLIC_KEY, # 응급실은 기존 PUBLIC_KEY 사용
        "STAGE1": "인천광역시",
        "numOfRows": "100"
    }

    try:
        response = requests.get(url, params=params)
        data = xmltodict.parse(response.content)
    except Exception as e:
        return jsonify({"error": f"공공데이터 통신 오류: {str(e)}"}), 500

    if "response" not in data or "body" not in data["response"] or "items" not in data["response"]["body"]:
        return jsonify([])
        
    items = data["response"]["body"]["items"]
    if not items:
        return jsonify([])

    items = items["item"]
    if not isinstance(items, list):
        items = [items]

    # CSV 매칭용 데이터 로드
    coords = {}
    try:
        with open(CSV_FILE, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for r in reader:
                try:
                    coords[r["요양기관명"]] = {
                        "lat": float(r["좌표(Y)"]),
                        "lng": float(r["좌표(X)"]),
                        "addr": r["주소"],
                        "phone": r["전화번호"]
                    }
                except:
                    continue
    except:
        pass 

    result = []
    for item in items:
        name = item.get("dutyName")
        if name not in coords:
            continue

        c = coords[name]
        dist = calculate_distance(user_lat, user_lon, c["lat"], c["lng"])

        result.append({
            "name": name,
            "address": c["addr"],
            "phone": item.get("dutyTel3"),
            "lat": c["lat"],
            "lng": c["lng"],
            "distance": round(dist, 2),
            "available": int(item.get("hvec", 0)),
            "status": "가능" if int(item.get("hvec", 0)) > 0 else "불가"
        })

    result.sort(key=lambda x: (x["status"] == "불가", x["distance"]))
    return jsonify(result[:10])


# ================================
# [API 3] 실시간 약국 (환경변수 키 + 반경 필터링 적용)
# ================================
@app.route("/api/pharmacy")
def get_pharmacy():
    user_lat = request.args.get("lat", type=float)
    user_lon = request.args.get("lon", type=float)
    # [수정] 반경 정보 받기 (기본값 3.0km)
    radius_km = request.args.get("radius", default=3.0, type=float)

    if user_lat is None or user_lon is None:
        return jsonify({"error": "위치 정보가 필요합니다."}), 400

    url = "http://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyLcinfoInqire"
    
    # [수정] .env에서 불러온 PHARMACY_KEY 사용
    # numOfRows를 200으로 늘려 넓은 반경 검색 대비
    params = {
        "serviceKey": PHARMACY_KEY, 
        "WGS84_LON": user_lon,
        "WGS84_LAT": user_lat,
        "pageNo": "1",
        "numOfRows": "200" 
    }

    try:
        response = requests.get(url, params=params)
        try:
            data = xmltodict.parse(response.content)
        except:
             return jsonify({"error": "공공데이터 응답 파싱 실패"}), 502

        if "response" not in data or "body" not in data["response"] or "items" not in data["response"]["body"]:
             return jsonify([])

        items = data["response"]["body"]["items"]
        if items is None:
            return jsonify([])

        items = items["item"]
        if not isinstance(items, list):
            items = [items]

        result = []
        for item in items:
            lat = safe_float(item.get("wgs84Lat"))
            lon = safe_float(item.get("wgs84Lon"))

            if lat is None or lon is None:
                continue

            dist = calculate_distance(user_lat, user_lon, lat, lon)

            # [수정] 계산된 거리가 사용자가 선택한 반경(radius_km) 이내인 경우만 결과에 포함
            if dist <= radius_km:
                result.append({
                    "name": item.get("dutyName"),
                    "address": item.get("dutyAddr"),
                    "phone": item.get("dutyTel1"),
                    "lat": lat,
                    "lng": lon,
                    "distance": round(dist, 2),
                    "status": is_pharmacy_open(item)
                })

        # 가까운 순 + 영업중 우선 정렬
        result.sort(key=lambda x: (x["status"] != "영업중", x["distance"]))
        return jsonify(result)

    except Exception as e:
        print(f"Pharmacy API Error: {e}")
        return jsonify({"error": str(e)}), 500


# ================================
# [API 4] AI 챗봇 (OpenAI)
# ================================
@app.route("/api/chat", methods=["POST"])
def chat_bot():
    data = request.json
    user_message = data.get("message")

    if not user_message:
        return jsonify({"error": "메시지가 없습니다."}), 400

    try:
        system_prompt = """
        너는 WITH 서비스의 의료 보조 AI야.
        사용자가 증상을 말하면 적절한 진료과를 2~3문장 안에서 추천해줘.
        마지막 문장은 반드시: '정확한 진단은 병원을 방문하세요.' 라고 끝내줘.
        """

        response = client.chat.completions.create(
            model="gpt-4o-mini",   
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ]
        )

        reply = response.choices[0].message.content
        return jsonify({"reply": reply})

    except Exception as e:
        print("🔥 OpenAI Error:", e)
        return jsonify({"error": "AI 서버 연결 오류가 발생했습니다."}), 500


# ================================
# 서버 실행
# ================================
if __name__ == "__main__":
    app.run(debug=True, port=5000)