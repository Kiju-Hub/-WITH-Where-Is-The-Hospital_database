import requests
import json
from mcp.server.fastmcp import FastMCP
from urllib.parse import urljoin # URL 관리 효율화

# Flask API 주소
FLASK_BASE = "http://localhost:5000"

mcp = FastMCP("hospital-mcp-tool")

def _fetch_data(endpoint: str, params: dict) -> str:
    """
    내부에서 재사용 가능한 데이터 요청 유틸리티 함수
    """
    url = urljoin(FLASK_BASE, endpoint)
    
    try:
        # requests 라이브러리는 params 딕셔너리를 사용하여 URL 인코딩을 안전하게 처리합니다.
        response = requests.get(url, params=params)
        response.raise_for_status() # 4xx 또는 5xx 오류 시 예외 발생
        
        data = response.json()
        
        if not data:
            return f"검색 결과가 없습니다. (API 엔드포인트: {endpoint})"
            
        # 한글 깨짐 방지를 위해 ensure_ascii=False 사용
        return json.dumps(data, ensure_ascii=False)
        
    except requests.exceptions.ConnectionError:
        return f"Error: Flask API 서버({FLASK_BASE})에 연결할 수 없습니다. 서버 실행 상태를 확인하세요."
    except requests.exceptions.HTTPError as e:
        return f"Error: HTTP 요청 실패. 상태 코드: {e.response.status_code}. 응답 내용: {e.response.text}"
    except Exception as e:
        # 그 외 JSON 파싱 오류 등 일반 예외 처리
        return f"Error fetching data from {endpoint}: {str(e)}"


@mcp.tool()
def search_hospitals(lat: float, lon: float, keyword: str = "", radius_km: float = 3.0) -> str:
    """
    사용자의 위치를 기반으로 일반 병원 목록을 가져오는 MCP 도구입니다.
    Flask API의 /api/hospitals 엔드포인트를 호출합니다.
    """
    params = {
        "lat": lat,
        "lon": lon,
        "keyword": keyword if keyword else "", # 빈 문자열 처리
        "radius": radius_km
    }
    return _fetch_data("/api/hospitals", params)


@mcp.tool()
def search_emergency(lat: float, lon: float) -> str:
    """
    Flask API의 실시간 응급실 검색 결과를 MCP 도구로 wrapping합니다.
    """
    params = {
        "lat": lat,
        "lon": lon
    }
    return _fetch_data("/api/emergency", params)


@mcp.tool()
def search_pharmacies(lat: float, lon: float, radius_km: float = 3.0) -> str:
    """
    주변 약국을 검색합니다. keyword='약국'을 고정하여 /api/hospitals 엔드포인트를 호출합니다.
    """
    params = {
        "lat": lat,
        "lon": lon,
        # 약국 검색을 위해 키워드를 '약국'으로 고정
        "keyword": "약국", 
        "radius": radius_km
    }
    return _fetch_data("/api/hospitals", params)

# mcp_server.py 에 추가할 내용

@mcp.tool()
def recommend_medical_department(symptom: str) -> str:
    """
    사용자의 증상에 따라 추천 진료과를 AI에게 문의하고 응답을 받습니다.
    Flask API의 /api/chat 엔드포인트를 호출합니다.
    """
    url = urljoin(FLASK_BASE, "/api/chat")
    
    try:
        # POST 요청으로 메시지를 전달
        response = requests.post(url, json={"message": symptom})
        response.raise_for_status()
        
        data = response.json()
        
        if 'reply' in data:
            # AI의 응답을 그대로 반환
            return data['reply']
        else:
            # Flask 서버에서 오류 메시지가 반환된 경우
            return f"AI 상담 오류: {data.get('error', '알 수 없는 오류')}"
            
    except requests.exceptions.ConnectionError:
        return f"Error: Flask API 서버({FLASK_BASE})에 연결할 수 없습니다. 서버 실행 상태를 확인하세요."
    except requests.exceptions.HTTPError as e:
        return f"Error: HTTP 요청 실패. 상태 코드: {e.response.status_code}. 응답 내용: {e.response.text}"
    except Exception as e:
        return f"Error using AI chat tool: {str(e)}"