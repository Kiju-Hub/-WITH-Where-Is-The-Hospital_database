from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
import csv
import os
import math
import requests
import xmltodict
from dotenv import load_dotenv
from datetime import datetime
from openai import OpenAI
from urllib.parse import unquote

# ================================
# 초기 설정
# ================================
basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

app = Flask(__name__)
CORS(app)

CSV_FILE = os.path.join(os.path.dirname(__file__), "data", "hospitals.csv")

# .env 파일에서 API 키 로드
PUBLIC_KEY = os.getenv("PUBLIC_DATA_API_KEY")
KAKAO_KEY = os.getenv("KAKAO_MAP_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
PHARMACY_KEY = os.getenv("PHARMACY_API_KEY")

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

# 시간 문자열 포맷팅 함수 [추가]
def format_time(time_str):
    """'0900' -> '09:00'"""
    if time_str and len(str(time_str)) == 4:
        # 안전을 위해 str()로 변환 후 처리
        s = str(time_str)
        return f"{s[:2]}:{s[2:]}"
    return "정보없음"

# 전체 영업 시간 요약 함수 [추가]
def format_all_pharmacy_hours(item):
    """요일별 영업시간을 보기 좋게 포맷합니다."""
    days = ["월", "화", "수", "목", "금", "토", "일"]
    formatted_hours = []
    
    # 공공데이터 포털은 1=월, 7=일을 사용
    for i in range(1, 8):
        start_key = f"dutyTime{i}s"
        end_key = f"dutyTime{i}c"
        
        start = item.get(start_key)
        end = item.get(end_key)
        
        day_name = days[i-1]
        
        if start and end:
            start_f = format_time(start)
            end_f = format_time(end)
            if start_f != "정보없음" and end_f != "정보없음":
                formatted_hours.append(f"{day_name}: {start_f} ~ {end_f}")
            else:
                 formatted_hours.append(f"{day_name}: 시간 확인 불가")
        else:
            # 해당 요일의 정보가 아예 없거나 (휴무) 불완전한 경우
            formatted_hours.append(f"{day_name}: 휴무 또는 정보없음")

    # 모든 요일 정보가 없다면 빈 문자열 반환
    if all("정보없음" in h or "휴무" in h or "확인 불가" in h for h in formatted_hours):
         return "" 
         
    return " | ".join(formatted_hours)

# 약국 영업시간 판별 [수정됨]
def is_pharmacy_open(item):
    now = datetime.now()
    weekdays = ["1", "2", "3", "4", "5", "6", "7"]
    day_code = weekdays[now.weekday()] 

    start_key = f"dutyTime{day_code}s"
    end_key = f"dutyTime{day_code}c"

    # .get()으로 값을 가져오고, 값이 유효한지 (None이나 빈 문자열이 아닌지) 확인합니다.
    start_time_str = item.get(start_key)
    end_time_str = item.get(end_key)
    
    if not start_time_str or not end_time_str:
        return "정보없음"

    try:
        current = int(now.strftime("%H%M"))
        start = int(start_time_str)
        end = int(end_time_str)
        
        # 새벽까지 영업하는 경우 (예: 2200 시작, 0200 종료) 처리
        if end <= 2400 and end < start:
             if current >= start or current <= end:
                 return "영업중"
             return "영업종료"


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
    radius_km = request.args.get("radius", default=3.0, type=float)

    if user_lat is None or user_lon is None:
        return jsonify({"error": "위치 정보가 필요합니다."}), 400

    result = []

    try:
        with open(CSV_FILE, encoding="utf-8") as f:
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

    url = "http://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire"
    
    params = {
        "serviceKey": unquote(PUBLIC_KEY), 
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
# [API 3] 실시간 약국 (좌표 처리 및 시간 추가)
# ================================
@app.route("/api/pharmacy")
def get_pharmacy():
    user_lat = request.args.get("lat", type=float)
    user_lon = request.args.get("lon", type=float)
    radius_km = request.args.get("radius", default=3.0, type=float)

    if user_lat is None or user_lon is None:
        return jsonify({"error": "위치 정보가 필요합니다."}), 400

    url = "http://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyLcinfoInqire"
    
    service_key_decoded = unquote(PHARMACY_KEY)

    params = {
        "serviceKey": service_key_decoded,
        "WGS84_LON": user_lon,
        "WGS84_LAT": user_lat,
        "pageNo": "1",
        "numOfRows": "200"
    }

    try:
        response = requests.get(url, params=params)
        
        print("🔍 약국 데이터 응답(Raw):", response.text[:500]) 

        try:
            data = xmltodict.parse(response.content)
        except:
             return jsonify({"error": "공공데이터 응답 파싱 실패"}), 502

        if "OpenAPI_ServiceResponse" in data:
            err_msg = data["OpenAPI_ServiceResponse"]["cmmMsgHeader"]["errMsg"]
            print(f"🔥 공공데이터 API 에러: {err_msg}")
            return jsonify({"error": err_msg}), 500

        if "response" not in data or "body" not in data["response"] or "items" not in data["response"]["body"]:
             print("⚠️ 데이터 없음 (items 태그가 비어있음)")
             return jsonify([])
        

        items = data["response"]["body"]["items"]
        if items is None:
            return jsonify([])

        items = items["item"]
        if not isinstance(items, list):
            items = [items]

        result = []
        for item in items:
            
            # wgs84 필드 우선 확인 후, 없으면 latitude/longitude 필드 확인
            lat = safe_float(item.get("wgs84Lat"))
            lon = safe_float(item.get("wgs84Lon"))

            
            
            if lat is None or lon is None:
                 lat = safe_float(item.get("latitude"))
                 lon = safe_float(item.get("longitude")) 

            if lat is None or lon is None:
                continue
                
            dist = calculate_distance(user_lat, user_lon, lat, lon)

            if dist <= radius_km:
                
                # 요일별 영업시간 데이터 수집 (시작~종료, 월~일)
                hours_data = {}
                for i in range(1, 8):
                    hours_data[f"time{i}s"] = item.get(f"dutyTime{i}s")
                    hours_data[f"time{i}c"] = item.get(f"dutyTime{i}c")
                    
                result.append({
                    "name": item.get("dutyName"),
                    "address": item.get("dutyAddr"),
                    "phone": item.get("dutyTel1"),
                    "lat": lat,
                    "lng": lon,
                    "distance": round(dist, 2),
                    "status": is_pharmacy_open(item),
                    "hours_raw": hours_data,
                    "hours_summary": format_all_pharmacy_hours(item) # [수정] 요약된 시간 추가
                })

        result.sort(key=lambda x: (x["status"] != "영업중", x["distance"]))
        return jsonify(result)

    except Exception as e:
        print(f"🔥 Pharmacy API System Error: {e}")
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
    app.run(
        debug=False,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )