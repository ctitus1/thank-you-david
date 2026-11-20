"""Public sources only. Every request and redirect stays within known hosts."""
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
import httpx
from .ingest import DataError, MAX_BYTES

TX_PAGE = 'https://www.hhs.texas.gov/providers/wic-providers/wic-vendor-management-operations-unit'
CA_PAGE = 'https://data.ca.gov/@california-department-of-public-health/california-wic-authorized-product-list'
ALLOWED = {'www.hhs.texas.gov', 'data.ca.gov', 'data.chhs.ca.gov'}


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.extend(v for k,v in attrs if k == 'href')


def fetch(url):
    for _ in range(4):
        parsed = urlparse(url)
        allowed = parsed.hostname in ALLOWED or (parsed.hostname == 's3.amazonaws.com' and parsed.path.startswith('/og-production-open-data-chelseama-892364687672/resources/ba9a5a8a-c9bd-4c19-afca-da1c3a2e137f/'))
        if parsed.scheme != 'https' or not allowed or parsed.port not in (None, 443) or parsed.username:
            raise DataError('The source points outside the supported public hosts.')
        try:
            with httpx.Client(timeout=httpx.Timeout(25, connect=10), trust_env=False) as client:
                with client.stream('GET', url, headers={'User-Agent': 'ThankYouDavid/1.0 (local WIC research)'}) as r:
                    if r.is_redirect:
                        url = urljoin(url, r.headers['location'])
                        continue
                    r.raise_for_status()
                    data = bytearray()
                    for chunk in r.iter_bytes():
                        data.extend(chunk)
                        if len(data) > MAX_BYTES:
                            raise DataError('The public file exceeds the 20 MB limit.')
                    return bytes(data), url
        except httpx.HTTPError:
            raise DataError('The public source is unavailable. Try again later or import a saved file. Existing data is unchanged.')
    raise DataError('The public source redirected too many times.')


def download(key):
    page = TX_PAGE if key == 'tx' else CA_PAGE
    content, _ = fetch(page)
    parser = Links()
    parser.feed(content.decode('utf-8', errors='replace'))
    needle = 'peanut-butter.xlsx' if key == 'tx' else 'ca-wic-apl-upc.csv'
    link = next((urljoin(page, x) for x in parser.links if needle in x.lower()), None)
    if not link:
        raise DataError('The publisher changed the download link. Import a saved file until the adapter is updated.')
    content, url = fetch(link)
    return content, needle, link
