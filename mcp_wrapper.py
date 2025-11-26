import requests
import json
from mcp.server.fastmcp import FastMCP

# Flask API 주소
FLASK_BASE = "http://localhost:5000"

mcp = FastMCP("hospital-mcp-tool")

@mcp.tool()
def search_hospitals(lat: float, lon: float, keyword: str = "", radius_km: float = 3.0) -> str:
    """
    사용자의 위치를 기반으로 일반 병원 목록을 가져오는 MCP 도구입니다.
    Flask API의 /api/hospitals 엔드포인트를 호출합니다.
    """
    # keyword가 None일 경우 빈 문자열로 처리
    safe_keyword = keyword if keyword else ""
    url = f"{FLASK_BASE}/api/hospitals?lat={lat}&lon={lon}&keyword={safe_keyword}&radius={radius_km}"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        return json.dumps(response.json(), ensure_ascii=False)
    except Exception as e:
        return f"Error fetching hospitals: {str(e)}"

@mcp.tool()
def search_emergency(lat: float, lon: float) -> str:
    """
    Flask API의 실시간 응급실 검색 결과를 MCP 도구로 wrapping합니다.
    """
    url = f"{FLASK_BASE}/api/emergency?lat={lat}&lon={lon}"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        return json.dumps(response.json(), ensure_ascii=False)
    except Exception as e:
        return f"Error fetching emergency data: {str(e)}"

# [추가됨] 약국 검색 도구
# mcp_server.py 수정 제안

@mcp.tool()
def search_pharmacies(lat: float, lon: float, radius_km: float = 3.0) -> str:
    """
    주변 약국을 검색합니다. keyword='약국'을 고정하여 호출합니다.
    """
    url = f"{FLASK_BASE}/api/hospitals"
    
    # [수정] params 딕셔너리 사용 (한글 깨짐 방지)
    params = {
        "lat": lat,
        "lon": lon,
        "keyword": "약국",
        "radius": radius_km
    }
    
    try:
        # requests가 자동으로 URL 인코딩을 처리해줍니다.
        response = requests.get(url, params=params)
        response.raise_for_status()
        
        data = response.json()
        
        # [디버깅 로그] 터미널에서 확인용
        print(f"DEBUG: 검색된 약국 개수: {len(data)}개")
        
        if not data:
            return "검색 결과가 없습니다. (CSV에 약국 데이터가 있는지 확인하세요)"
            
        return json.dumps(data, ensure_ascii=False)
        
    except Exception as e:
        return f"Error fetching pharmacies: {str(e)}"