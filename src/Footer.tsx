import React from "react";

function Footer() {
    return (
        <footer>
            <div className="container">
                <div className="row row1">
                    <h2>Vi lytter til dere!</h2>
                    <p>
                        Traskende rundt i sykehuskorridorene med en oppmøtebok du alltid er redd for å miste eller søle
                        kaffekoppen
                        på, begynner man å fundere på om det går an å gjøre livet litt enklere… Så hvorfor ikke lage en
                        digital
                        oppmøtebok du aldri glemmer hjemme, som er superrask for lærerne og sparer fakultetet for
                        over 3000(!) papirutgaver
                        i året?
                    </p>
                    <br />
                    <p>
                        Miljøvennlig, effektivt og bedre for studentene. Velkommen til Oppmøteboka – skapt mellom
                        uttrykning på vakt
                        eller halvsovende på sofaen i de sene nattestimer. Send oss en melding om du har noe tips til
                        hva vi bør
                        gjøre!
                    </p>
                </div>
                <div className="row row2">
                    <img src="/logo.svg" alt="Oppmøteboka logo"/>
                    <p className={"normalFont"}><a
                        className={"link"}
                        href="mailto:hei@sablateknisk.no?subject=Tilbakelding"
                    >
                        Gi tilbakemelding
                    </a></p>
                    <p>hei@sablateknisk.no</p>
                    <br/>
                    <p className="smallText">Nettisden er utviklet av<br/> Vetle Mørland og Åge Frivoll</p>
                </div>
            </div>
        </footer>
    );
}

export default Footer;
