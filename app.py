from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
import csv
import os
import math
import requests
import xmltodict
from dotenv import load_dotenv

# 1. .env 파일 로드
basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

app = Flask(__name__)
CORS(app)

# CSV 파일 경로
CSV_FILE = os.path.join(os.path.dirname(__file__), "data", "hospitals.csv")

# 2. 환경변수에서 키 가져오기
PUBLIC_KEY = os.getenv("PUBLIC_DATA_API_KEY")
KAKAO_KEY = os.getenv("KAKAO_MAP_API_KEY")

print("---------------------------------------------------")
print(f"🔑 공공데이터 키 로드: {PUBLIC_KEY}")
print("---------------------------------------------------")

# 거리 계산 함수
def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# 메인 페이지
@app.route("/")
def home():
    return render_template("index.html", kakao_key=KAKAO_KEY)

# [API 1] 일반 병원 검색
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
        with open(CSV_FILE, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    if not row.get("좌표(Y)") or not row.get("좌표(X)"): continue
                    name = row["요양기관명"]
                    if keyword and (keyword not in name): continue
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
                except ValueError: continue
    except FileNotFoundError:
        return jsonify({"error": "CSV 파일이 없습니다."}), 500
    
    result.sort(key=lambda x: x["distance"])
    return jsonify(result)

# [API 2] 실시간 응급실 검색 (URL 수정됨!)
@app.route("/api/emergency")
def get_emergency_realtime():
    user_lat = request.args.get("lat", type=float)
    user_lon = request.args.get("lon", type=float)
    
    # 올바른 API 주소
    url = "http://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire"
    
    params = {
        "serviceKey": PUBLIC_KEY,
        "STAGE1": "인천광역시", 
        "numOfRows": "100"
    }

    try:
        response = requests.get(url, params=params)
        
        # XML 파싱 시도
        try:
            data_dict = xmltodict.parse(response.content)
        except Exception:
            return jsonify({"error": f"공공데이터 API 오류: {response.text}"}), 500
        
        # 데이터 구조 확인
        if "response" not in data_dict or "body" not in data_dict["response"]:
            return jsonify({"error": "데이터 구조가 올바르지 않습니다."}), 500
            
        items = data_dict["response"]["body"]["items"]
        if not items: return jsonify([]) 

        items = items["item"]
        if not isinstance(items, list): items = [items]

        candidates = [] # 모든 매칭된 병원을 담을 임시 리스트
        hospital_coords = {}
        
        # CSV 매칭용 데이터 로드
        with open(CSV_FILE, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    if not row.get("좌표(Y)") or not row.get("좌표(X)"): 
                        continue
                    
                    hospital_coords[row["요양기관명"]] = {
                        "lat": float(row["좌표(Y)"]),
                        "lng": float(row["좌표(X)"]),
                        "addr": row["주소"],
                        "phone": row["전화번호"]
                    }
                except ValueError:
                    continue

        for item in items:
            name = item.get("dutyName")
            
            try:
                er_count = int(item.get("hvec", 0))
            except ValueError:
                er_count = 0
            
            if name in hospital_coords:
                info = hospital_coords[name]
                dist = calculate_distance(user_lat, user_lon, info["lat"], info["lng"])
                
                # 거리 상관없이 일단 후보군에 모두 추가합니다
                candidates.append({
                    "name": name,
                    "address": info["addr"],
                    "phone": item.get("dutyTel3"),
                    "lat": info["lat"],
                    "lng": info["lng"],
                    "distance": round(dist, 2),
                    "available": er_count,
                    "status": "가능" if er_count > 0 else "불가"
                })
        
        # 1. 거리순으로 전체 정렬
        candidates.sort(key=lambda x: x["distance"])

        # 2. 5km 이내 병원만 필터링 시도
        result = [h for h in candidates if h["distance"] <= 5.0]

        # 3. [핵심] 만약 5km 이내에 없다면? -> 가장 가까운 상위 5개 가져오기 (Fallback)
        if not result:
            result = candidates[:5]

        # 4. 최종 정렬: (병상 없는 곳은 뒤로 보냄 + 거리순)
        result.sort(key=lambda x: (x["status"] == "불가", x["distance"]))
        
        return jsonify(result)

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)