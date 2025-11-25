from flask import Flask, jsonify, request
from flask_cors import CORS
import csv
import os
import math

app = Flask(__name__)
CORS(app)  # 모든 도메인에서 접속 허용

# CSV 파일 경로 (backend 폴더 내 data 폴더가 있다고 가정)
CSV_FILE = os.path.join(os.path.dirname(__file__), "data", "hospitals.csv")

# 두 좌표 사이의 거리 계산 함수 (Haversine 공식)
def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371  # 지구 반지름 (km)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    distance = R * c
    return distance

@app.route("/")
def home():
    return "WITH API Server is Running!"

# app.py 상단의 get_hospitals 함수 전체를 교체하세요

@app.route("/api/hospitals")
def get_hospitals():
    user_lat = request.args.get("lat", type=float)
    user_lon = request.args.get("lon", type=float)
    # 추가된 파라미터 받기 (기본값 설정)
    keyword = request.args.get("keyword", default="", type=str)  # 검색어 (예: 내과)
    radius_km = request.args.get("radius", default=5.0, type=float) # 반경

    if user_lat is None or user_lon is None:
        return jsonify({"error": "위치 정보가 필요합니다."}), 400

    result = []

    try:
        with open(CSV_FILE, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            
            for row in reader:
                try:
                    # 1. 데이터 유효성 검사
                    if not row.get("좌표(Y)") or not row.get("좌표(X)"):
                        continue
                    
                    name = row["요양기관명"]
                    
                    # 2. 검색어 필터링 (핵심!)
                    # 검색어가 있는데, 병원 이름에 그 단어가 없으면 탈락!
                    if keyword and (keyword not in name):
                        continue

                    h_lat = float(row["좌표(Y)"])
                    h_lon = float(row["좌표(X)"])

                    dist = calculate_distance(user_lat, user_lon, h_lat, h_lon)

                    # 3. 사용자 지정 반경 내에 있는지 확인
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
        return jsonify({"error": "CSV 파일 없음"}), 500

    result.sort(key=lambda x: x["distance"])
    return jsonify(result)

    # 거리가 가까운 순서대로 정렬
    result.sort(key=lambda x: x["distance"])
    
    return jsonify(result)

if __name__ == "__main__":
    app.run(debug=True, port=5000)